import type express from 'express';
import type { Redis } from 'ioredis';
import multer from 'multer';
import { Transform, type Writable } from 'node:stream';
import type { PrismaClient } from '../../generated/prisma/index.js';
import {
  requireAuth,
  requireApiToken,
  requireInternalOwner,
  requireMembership,
  getTenantFromReq,
} from '../utils/authHelpers.js';
import { isTenantAccessDenied } from '../utils/tenantAccessState.js';
import { detectMimeFromMagic } from '../utils/mediaMime.js';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../logger.js';
import { getSharedRedis } from '../../ops/redisConnection.js';

const MiB = 1024 * 1024;
export type UploadKind = 'asset' | 'avatar' | 'npc' | 'admin_map' | 'tmj';
const REQUEST_LIMITS: Record<UploadKind, number> = {
  asset: 51 * MiB,
  avatar: 6 * MiB,
  npc: 101 * MiB,
  admin_map: 51 * MiB,
  tmj: 61 * MiB,
};
const FILE_LIMITS: Record<UploadKind, number> = {
  asset: 50 * MiB,
  avatar: 5 * MiB,
  npc: 100 * MiB,
  admin_map: 50 * MiB,
  tmj: 10 * MiB,
};
type Budget = { start: number; attempts: number; active: number };
const budgets = new Map<string, Budget>();
const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 10;
const MAX_ACTIVE = 2;
const ACTIVE_TTL_MS = 30 * 60_000;
const REDIS_FAILURE_LOG_INTERVAL_MS = 30_000;
const ACQUIRE_UPLOAD_BUDGET_SCRIPT = `
local active = tonumber(redis.call('GET', KEYS[2]) or '0')
local attempts = tonumber(redis.call('GET', KEYS[1]) or '0')
if active >= tonumber(ARGV[3]) or attempts >= tonumber(ARGV[2]) then
  return 0
end
if redis.call('INCR', KEYS[1]) == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
return 1
`;
const RELEASE_UPLOAD_BUDGET_SCRIPT = `
local active = tonumber(redis.call('GET', KEYS[1]) or '0')
if active > 0 then
  return redis.call('DECR', KEYS[1])
end
return 0
`;
let lastRedisFailureLoggedAt = 0;

function logRedisFailure(error: unknown): void {
  const now = Date.now();
  if (now - lastRedisFailureLoggedAt < REDIS_FAILURE_LOG_INTERVAL_MS) return;
  lastRedisFailureLoggedAt = now;
  logger.error({
    event: 'upload_budget.redis_failed',
    error: error instanceof Error ? error.message : String(error),
  });
}

type UploadBudgetResult =
  { status: 'acquired'; release: () => void } | { status: 'limited' } | { status: 'unavailable' };

async function acquireRedisBudget(
  redis: Redis,
  userId: string,
  res: express.Response,
  next: express.NextFunction,
): Promise<UploadBudgetResult> {
  const attemptsKey = `upload:attempts:${userId}`;
  const activeKey = `upload:active:${userId}`;
  try {
    const acquired = await redis.eval(
      ACQUIRE_UPLOAD_BUDGET_SCRIPT,
      2,
      attemptsKey,
      activeKey,
      WINDOW_MS,
      MAX_ATTEMPTS,
      MAX_ACTIVE,
      ACTIVE_TTL_MS,
    );
    if (acquired !== 1 && acquired !== '1') {
      let retryAfter = 1;
      try {
        const active = Number((await redis.get(activeKey)) ?? 0);
        if (active < MAX_ACTIVE) {
          const ttl = await redis.pttl(attemptsKey);
          retryAfter = Math.max(1, Math.ceil((ttl > 0 ? ttl : WINDOW_MS) / 1000));
        }
      } catch (error) {
        logRedisFailure(error);
      }
      res.setHeader('Retry-After', retryAfter);
      next(AppError.tooManyRequests('Please wait before another upload.', 'UPLOAD_RATE_LIMITED'));
      return { status: 'limited' };
    }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      void (async () => {
        try {
          await redis.eval(RELEASE_UPLOAD_BUDGET_SCRIPT, 1, activeKey);
        } catch (error) {
          logRedisFailure(error);
        }
      })();
    };
    return { status: 'acquired', release };
  } catch (error) {
    logRedisFailure(error);
    return { status: 'unavailable' };
  }
}

function acquireLocalBudget(
  userId: string,
  res: express.Response,
  next: express.NextFunction,
): { status: 'acquired'; release: () => void } | { status: 'limited' } {
  const now = Date.now();
  for (const [key, value] of budgets) if (!value.active && now - value.start >= WINDOW_MS) budgets.delete(key);
  const budget = budgets.get(userId) ?? { start: now, attempts: 0, active: 0 };
  if (now - budget.start >= WINDOW_MS) {
    budget.start = now;
    budget.attempts = 0;
  }
  budgets.set(userId, budget);
  if (budget.active >= MAX_ACTIVE || budget.attempts >= MAX_ATTEMPTS) {
    res.setHeader(
      'Retry-After',
      budget.active >= MAX_ACTIVE ? 1 : Math.max(1, Math.ceil((budget.start + WINDOW_MS - now) / 1000)),
    );
    next(AppError.tooManyRequests('Please wait before another upload.', 'UPLOAD_RATE_LIMITED'));
    return { status: 'limited' };
  }
  budget.attempts++;
  budget.active++;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      budget.active--;
    }
  };
  return { status: 'acquired', release };
}

function registerBudgetRelease(req: express.Request, res: express.Response, release: () => void): void {
  res.once('finish', release);
  res.once('close', release);
  req.once('aborted', release);
  req.once('error', release);
}

const abortParsers = new WeakMap<express.Request, (error: Error) => void>();
const reportParserErrors = new WeakMap<express.Request, (error: Error) => void>();

/**
 * Verify identity and role before any parser starts collecting data.
 * Without a shared Redis client the upload budget stays in the process-local
 * map below; with Redis one Lua script checks and counts attempts and active
 * uploads atomically across processes. If Redis fails, the guard falls back
 * to the local map for that request, and release() always settles the budget
 * on the path that counted the attempt.
 */
export function uploadGuard(prisma: PrismaClient, kind: UploadKind): express.RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const auth = requireAuth(req) ?? (await requireApiToken(req, prisma));
      if (!auth) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const global = kind === 'asset' || kind === 'avatar' || kind === 'admin_map';
      const tenant = getTenantFromReq(req);
      if (!global && !tenant && isTenantAccessDenied(req)) {
        // The caller named a tenant it may not access; tenantAccess dropped it.
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      if (!global && !tenant) {
        res.status(400).json({ error: 'tenant_required' });
        return;
      }
      const member = global ? null : await requireMembership(req, auth.userId, prisma);
      const allowed = global
        ? await requireInternalOwner(req, auth.userId, prisma)
        : !!tenant && (member?.role === 'owner' || member?.role === 'admin');
      if (!allowed) {
        if (kind === 'tmj' && tenant && member && member.role !== 'owner' && member.role !== 'admin') {
          res.status(403).json({ error: 'forbidden - admin required' });
          return;
        }
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      let release: (() => void) | null = null;
      const redis = getSharedRedis();
      if (redis) {
        const outcome = await acquireRedisBudget(redis, auth.userId, res, next);
        if (outcome.status === 'limited') return;
        if (outcome.status === 'acquired') release = outcome.release;
      }
      if (!release) {
        const outcome = acquireLocalBudget(auth.userId, res, next);
        if (outcome.status === 'limited') return;
        release = outcome.release;
      }
      registerBudgetRelease(req, res, release);
      const limit = REQUEST_LIMITS[kind];
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > limit) {
        res.setHeader('Connection', 'close');
        next(new AppError('Upload request too large.', 413, 'UPLOAD_TOO_LARGE'));
        return;
      }
      next();
    })().catch(next);
  };
}

/** Enforce field-specific limits before Buffer.concat in addition to Busboy limits. */
function createUploadStorage(kind: UploadKind): multer.StorageEngine {
  return {
    _handleFile(req, file, callback) {
      let prefix = Buffer.alloc(0);
      let limit = kind === 'tmj' && file.fieldname === 'images' ? 5 * MiB : FILE_LIMITS[kind];
      const chunks: Buffer[] = [];
      let size = 0;
      let finished = false;
      const finish = (error: Error | null) => {
        if (finished) {
          return;
        }
        finished = true;
        if (error) {
          abortParsers.get(req)?.(error);
        }
        callback(error, error ? undefined : { buffer: Buffer.concat(chunks, size), size });
        chunks.length = 0;
      };
      file.stream.on('data', (chunk: Buffer) => {
        if (finished) {
          return;
        }
        size += chunk.length;
        if (kind === 'npc') {
          if (prefix.length < 4) {
            prefix = Buffer.concat([prefix, chunk.subarray(0, 4 - prefix.length)]);
          }
          const mime = prefix.length === 4 ? (detectMimeFromMagic(prefix) ?? file.mimetype) : file.mimetype;
          limit = mime.startsWith('audio/') ? 25 * MiB : FILE_LIMITS[kind];
        }
        if (size > limit) {
          finish(new AppError('File too large.', 413, 'UPLOAD_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      file.stream.once('error', finish);
      file.stream.once('end', () => finish(null));
    },
    _removeFile(_req, file, callback) {
      delete (file as Partial<Express.Multer.File>).buffer;
      callback(null);
    },
  };
}

function createStreamHandler(kind: UploadKind): (req: express.Request, parser: Writable) => void {
  return (req, parser) => {
    let bytes = 0;
    let stopped = false;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        if (bytes > REQUEST_LIMITS[kind]) {
          done(new AppError('Upload request too large.', 413, 'UPLOAD_TOO_LARGE'));
          return;
        }
        done(null, chunk);
      },
    });
    const stop = (error: Error) => {
      if (stopped) {
        return;
      }
      stopped = true;
      req.unpipe(meter);
      meter.unpipe(parser);
      meter.destroy();
      parser.destroy(error);
      req.resume();
      reportParserErrors.get(req)?.(error);
    };
    abortParsers.set(req, stop);
    meter.once('error', stop);
    parser.once('error', stop);
    parser.once('close', () => {
      req.unpipe(meter);
      meter.destroy();
      abortParsers.delete(req);
    });
    parser.on('field', (_name: string, _value: string, info: { valueTruncated: boolean }) => {
      if (info.valueTruncated) {
        stop(new AppError('Upload field too large.', 413, 'UPLOAD_TOO_LARGE'));
      }
    });
    for (const event of ['partsLimit', 'filesLimit', 'fieldsLimit']) {
      parser.once(event, () => stop(new AppError('Too many upload parts.', 413, 'UPLOAD_TOO_LARGE')));
    }
    req.pipe(meter).pipe(parser);
  };
}

export function uploadParser(kind: UploadKind): multer.Multer {
  const storage = createUploadStorage(kind);
  const files = kind === 'tmj' ? 11 : 1;
  // Multer 2.4.0 documents streamHandler; the installed types do not yet include
  // this option. Keep the existing version and lockfile.
  const options: multer.Options & {
    streamHandler: (req: express.Request, parser: Writable) => void;
  } = {
    storage,
    limits: {
      fileSize: FILE_LIMITS[kind] + 1,
      files,
      fields: 16,
      // Multer 2.5 treats fieldSize as the largest accepted value and passes
      // one more to busboy itself.
      fieldSize: 64 * 1024,
      parts: files + 17,
    },
    streamHandler: createStreamHandler(kind),
  };
  return multer(options);
}

/** Treat Multer limits as client errors without logging names, filenames or bodies. */
export function boundedMultipart(parser: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    let completed = false;
    const finish = (error?: unknown) => {
      if (completed) return;
      completed = true;
      reportParserErrors.delete(req);
      if (res.headersSent || res.destroyed || req.aborted) return;
      if (error instanceof multer.MulterError) {
        const size =
          [
            'LIMIT_FILE_SIZE',
            'LIMIT_FILE_COUNT',
            'LIMIT_FIELD_COUNT',
            'LIMIT_FIELD_VALUE',
            'LIMIT_PART_COUNT',
          ].includes(error.code) ||
          (error.code === 'LIMIT_UNEXPECTED_FILE' && (error.field === 'file' || error.field === 'images'));
        next(
          new AppError(
            size ? 'Upload limit exceeded.' : 'Invalid upload.',
            size ? 413 : 400,
            size ? 'UPLOAD_TOO_LARGE' : 'UPLOAD_INVALID',
          ),
        );
        return;
      }
      next(error);
    };
    reportParserErrors.set(req, finish);
    parser(req, res, finish);
  };
}
