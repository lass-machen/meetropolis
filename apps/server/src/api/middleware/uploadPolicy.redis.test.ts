import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { AppError } from '../../errors/AppError.js';
import { closeSharedRedis, getSharedRedis } from '../../ops/redisConnection.js';
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

const userIds: string[] = [];

function newUserId(prefix: string): string {
  const userId = `${prefix}-${crypto.randomUUID()}`;
  userIds.push(userId);
  return userId;
}

async function release(run: UploadRun, userId: string): Promise<void> {
  run.res.emit('finish');
  const redis = getSharedRedis();
  await vi.waitFor(async () => {
    expect(await redis?.get(`upload:active:${userId}`)).not.toBe('2');
  });
}

describe.skipIf(!process.env.REDIS_TEST_URL)('uploadGuard with Redis', () => {
  beforeAll(() => {
    process.env.REDIS_URL = process.env.REDIS_TEST_URL;
  });

  afterAll(async () => {
    const redis = getSharedRedis();
    if (redis && userIds.length > 0) {
      await redis.del(userIds.flatMap((userId) => [`upload:attempts:${userId}`, `upload:active:${userId}`]));
    }
    await closeSharedRedis();
    delete process.env.REDIS_URL;
  });

  it('shares the concurrent budget across two guard instances and frees it on release', async () => {
    const firstGuard = uploadGuard(makePrismaStub(), 'avatar');
    const secondGuard = uploadGuard(makePrismaStub(), 'avatar');
    const userId = newUserId('redis-concurrent-user');

    const first = await runUpload(firstGuard, userId);
    const second = await runUpload(secondGuard, userId);
    expect(first.error).toBeUndefined();
    expect(second.error).toBeUndefined();

    expectRateLimited(await runUpload(secondGuard, userId));

    await release(first, userId);
    const afterRelease = await runUpload(secondGuard, userId);
    expect(afterRelease.error).toBeUndefined();

    second.res.emit('finish');
    afterRelease.res.emit('finish');
  });

  it('rejects the eleventh attempt in the window across two guard instances', async () => {
    const firstGuard = uploadGuard(makePrismaStub(), 'avatar');
    const secondGuard = uploadGuard(makePrismaStub(), 'avatar');
    const userId = newUserId('redis-attempts-user');

    for (let attempt = 0; attempt < 10; attempt++) {
      const run = await runUpload(attempt % 2 ? secondGuard : firstGuard, userId);
      expect(run.error).toBeUndefined();
      await release(run, userId);
    }

    expectRateLimited(await runUpload(firstGuard, userId));
  });
});
