import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '../../db.js';
import { hashEmailProof } from '../utils/emailProof.js';

vi.mock('../../logger.js', () => ({
  logger: {
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  },
}));

if (!process.env.DATABASE_URL) throw new Error('auth.verify.integration.test.ts needs DATABASE_URL');

const prisma = createPrismaClient();
const userIds: string[] = [];

const envKeys = [
  'NODE_ENV',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_FROM',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'PUBLIC_BASE_URL',
  'PUBLIC_BASE_URL_ALLOW_LOOPBACK',
] as const;
type EnvKey = (typeof envKeys)[number];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as Record<
  EnvKey,
  string | undefined
>;

function restoreEnv(): void {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}

function setEnv(values: Partial<Record<EnvKey, string | undefined>>): void {
  restoreEnv();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key as EnvKey];
    else process.env[key as EnvKey] = value;
  }
}

afterEach(async () => {
  const currentUserIds = userIds.splice(0);
  if (currentUserIds.length) {
    await prisma.authEvent.deleteMany({ where: { userId: { in: currentUserIds } } });
    await prisma.emailVerification.deleteMany({ where: { userId: { in: currentUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: currentUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: currentUserIds } } });
  }
  restoreEnv();
});

afterAll(async () => {
  await prisma.$disconnect();
  restoreEnv();
});

async function setupCase(env: Partial<Record<EnvKey, string | undefined>>): Promise<{
  app: express.Application;
  userId: string;
}> {
  setEnv(env);
  vi.resetModules();
  const { handleVerifyRequest, handleVerifyToken } = await import('./auth.verify.js');
  const { setAuthResolution } = await import('../utils/authState.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.headers['x-user'];
    setAuthResolution(req, {
      auth: typeof userId === 'string' ? { userId, sessionId: `sess-${userId}`, tokenHash: `hash-${userId}` } : null,
    });
    next();
  });
  app.post('/auth/verify/request', (req, res) => handleVerifyRequest(prisma, req, res));
  app.post('/auth/verify', (req, res) => handleVerifyToken(prisma, req, res));
  const suffix = crypto.randomUUID();
  const user = await prisma.user.create({ data: { email: `verify-${suffix}@example.test` } });
  userIds.push(user.id);
  return { app, userId: user.id };
}

describe('verification token surfacing', () => {
  it('answers 503 EMAIL_DELIVERY_UNAVAILABLE when a configured provider cannot deliver', async () => {
    const { app, userId } = await setupCase({
      NODE_ENV: 'production',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1',
      SMTP_FROM: 'verify@meetropolis.test',
      SMTP_SECURE: 'false',
      SMTP_USER: undefined,
      SMTP_PASS: undefined,
      PUBLIC_BASE_URL: 'https://verify.example',
      PUBLIC_BASE_URL_ALLOW_LOOPBACK: undefined,
    });
    const response = await request(app).post('/auth/verify/request').set('x-user', userId).send({});
    const body = response.body as { code?: unknown; token?: unknown; verifyUrl?: unknown };
    expect(response.status).toBe(503);
    expect(body.code).toBe('EMAIL_DELIVERY_UNAVAILABLE');
    expect(body.token).toBeUndefined();
    expect(body.verifyUrl).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/token/i);
    // The prepared proof row stays, never marked ready and expired at once
    // after the failed delivery.
    const proofs = await prisma.emailVerification.findMany({ where: { userId } });
    expect(proofs).toHaveLength(1);
    expect(proofs[0].readyAt).toBeNull();
    expect(proofs[0].usedAt).toBeNull();
    expect(proofs[0].expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('answers 503 EMAIL_DELIVERY_UNAVAILABLE without a delivering provider and returns no token', async () => {
    const { app, userId } = await setupCase({
      NODE_ENV: 'production',
      SMTP_HOST: undefined,
      SMTP_FROM: undefined,
      SMTP_USER: undefined,
      SMTP_PASS: undefined,
      PUBLIC_BASE_URL: 'https://verify.example',
      PUBLIC_BASE_URL_ALLOW_LOOPBACK: undefined,
    });
    const response = await request(app).post('/auth/verify/request').set('x-user', userId).send({});
    const body = response.body as { code?: unknown; token?: unknown; verifyUrl?: unknown };
    expect(response.status).toBe(503);
    expect(body.code).toBe('EMAIL_DELIVERY_UNAVAILABLE');
    expect(body.token).toBeUndefined();
    expect(body.verifyUrl).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/token/i);
    // The console fallback does not count as delivery; the check runs
    // before a proof row is prepared.
    expect(await prisma.emailVerification.count({ where: { userId } })).toBe(0);
  });

  it('returns neither a token nor a link in development', async () => {
    const { app, userId } = await setupCase({
      NODE_ENV: 'development',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1',
      SMTP_FROM: 'verify@meetropolis.test',
      SMTP_SECURE: 'false',
      SMTP_USER: undefined,
      SMTP_PASS: undefined,
      PUBLIC_BASE_URL: 'https://verify.example',
      PUBLIC_BASE_URL_ALLOW_LOOPBACK: undefined,
    });
    const response = await request(app).post('/auth/verify/request').set('x-user', userId).send({});
    const body = response.body as { code?: unknown; token?: unknown; verifyUrl?: unknown };
    expect(response.status).toBe(503);
    expect(body.code).toBe('EMAIL_DELIVERY_UNAVAILABLE');
    expect(body.token).toBeUndefined();
    expect(body.verifyUrl).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/token/i);
  });
});

describe('consumed verification token', () => {
  it('records an email_verification auth event for the verified account', async () => {
    const { app, userId } = await setupCase({});
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const rawToken = `verify-${crypto.randomUUID()}`;
    await prisma.emailVerification.create({
      data: {
        token: hashEmailProof(rawToken),
        userId,
        email: user.email,
        sourceEmail: user.email,
        purpose: 'verify',
        readyAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const response = await request(app).post('/auth/verify').set('x-user', userId).send({ token: rawToken });

    expect(response.status).toBe(200);
    const events = await prisma.authEvent.findMany({ where: { userId, type: 'email_verification' } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ success: true, tenantId: null });
  });
});
