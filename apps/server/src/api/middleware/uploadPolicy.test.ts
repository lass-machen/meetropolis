import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type express from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../logger.js';
import { closeSharedRedis } from '../../ops/redisConnection.js';
import { setAuthResolution } from '../utils/authState.js';
import { uploadGuard } from './uploadPolicy.js';

class FakeRequest extends EventEmitter {
  headers: Record<string, string | undefined> = {};
}

class FakeResponse extends EventEmitter {
  headers = new Map<string, unknown>();
  setHeader(name: string, value: unknown): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }
}

function makePrismaStub(): PrismaClient {
  return {
    tenant: { findUnique: vi.fn(() => Promise.resolve({ id: 'internal-id' })) },
    membership: {
      findUnique: vi.fn(() => Promise.resolve({ role: 'owner', expiresAt: null, inviteVerificationRequired: false })),
    },
  } as unknown as PrismaClient;
}

type UploadRun = { req: FakeRequest; res: FakeResponse; error: unknown };

async function runUpload(handler: express.RequestHandler, userId: string): Promise<UploadRun> {
  const req = new FakeRequest();
  const res = new FakeResponse();
  setAuthResolution(req as unknown as express.Request, {
    auth: { userId, sessionId: `session-${userId}`, tokenHash: `hash-${userId}` },
  });
  const error = await new Promise<unknown>((resolve) => {
    handler(req as unknown as express.Request, res as unknown as express.Response, (nextError?: unknown) =>
      resolve(nextError),
    );
  });
  return { req, res, error };
}

function expectRateLimited(run: UploadRun): void {
  expect(run.error).toBeInstanceOf(AppError);
  expect((run.error as AppError).statusCode).toBe(429);
  expect((run.error as AppError).code).toBe('UPLOAD_RATE_LIMITED');
  expect(Number(run.res.headers.get('retry-after'))).toBeGreaterThan(0);
}

describe('uploadGuard without Redis', () => {
  it('rejects a third concurrent upload and allows another after release', async () => {
    delete process.env.REDIS_URL;
    const handler = uploadGuard(makePrismaStub(), 'avatar');
    const userId = `map-user-${crypto.randomUUID()}`;

    const first = await runUpload(handler, userId);
    const second = await runUpload(handler, userId);
    expect(first.error).toBeUndefined();
    expect(second.error).toBeUndefined();

    expectRateLimited(await runUpload(handler, userId));

    first.res.emit('finish');
    const afterRelease = await runUpload(handler, userId);
    expect(afterRelease.error).toBeUndefined();

    second.res.emit('finish');
    afterRelease.res.emit('finish');
  });

  it('falls back to the local budget when Redis is unreachable and logs the failure', async () => {
    const errorSpy = vi.spyOn(logger, 'error');
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    try {
      const handler = uploadGuard(makePrismaStub(), 'avatar');
      const userId = `fallback-user-${crypto.randomUUID()}`;

      const first = await runUpload(handler, userId);
      const second = await runUpload(handler, userId);
      expect(first.error).toBeUndefined();
      expect(second.error).toBeUndefined();

      expectRateLimited(await runUpload(handler, userId));
      expect(errorSpy).toHaveBeenCalled();

      first.res.emit('finish');
      second.res.emit('finish');
    } finally {
      errorSpy.mockRestore();
      delete process.env.REDIS_URL;
      await closeSharedRedis();
    }
  });
});
