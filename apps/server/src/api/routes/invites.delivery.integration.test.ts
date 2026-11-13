import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '../../db.js';
import { getEmailModule } from '../../emailLoader.js';
import { setAuthResolution } from '../utils/authState.js';
import { handleAuthInvite } from './auth.signin.js';

const capturedLogs = vi.hoisted(() => {
  process.env.RATE_LIMIT_ENABLED = 'false';
  const originalNodeEnv = process.env.NODE_ENV;
  if (process.env.NODE_ENV === 'test') process.env.NODE_ENV = 'development';
  return { events: [] as Array<{ level: string; value: unknown }>, originalNodeEnv };
});

vi.mock('../../logger.js', () => ({
  logger: {
    debug: (value: unknown) => capturedLogs.events.push({ level: 'debug', value }),
    error: (value: unknown) => capturedLogs.events.push({ level: 'error', value }),
    info: (value: unknown) => capturedLogs.events.push({ level: 'info', value }),
    warn: (value: unknown) => capturedLogs.events.push({ level: 'warn', value }),
  },
}));

vi.mock('../../tenancyLoader.js', () => ({
  getTenancyModule: () => Promise.resolve({ isMultiTenantEnabled: () => true }),
}));

if (!process.env.DATABASE_URL) throw new Error('invites.delivery.integration.test.ts needs DATABASE_URL');

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
const smtpEnvKeys = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_FROM',
  'SMTP_TLS_REJECT_UNAUTHORIZED',
  'PUBLIC_BASE_URL',
  'PUBLIC_BASE_URL_ALLOW_LOOPBACK',
] as const;
type SmtpEnvKey = (typeof smtpEnvKeys)[number];
let originalSmtpEnv: Record<SmtpEnvKey, string | undefined>;

interface Fixture {
  app: express.Application;
  tenantId: string;
  ownerId: string;
}

interface InviteResponse {
  code: string;
  role: string;
  inviteUrl: string;
  expiresAt: string | null;
  emailSent: boolean;
}

function makeApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.headers['x-user'];
    setAuthResolution(req, {
      auth: typeof userId === 'string' ? { userId, sessionId: `sess-${userId}`, tokenHash: `hash-${userId}` } : null,
    });
    const tenantId = req.headers['x-tenant'];
    if (typeof tenantId === 'string') req.tenant = { id: tenantId, slug: tenantId, name: tenantId } as never;
    next();
  });
  app.post('/auth/invite', (req, res) => handleAuthInvite(prisma, req, res));
  return app;
}

async function createFixture(): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const tenant = await prisma.tenant.create({ data: { slug: `delivery-${suffix}`, name: `Delivery ${suffix}` } });
  tenantIds.push(tenant.id);
  const owner = await prisma.user.create({ data: { email: `owner-${suffix}@example.test` } });
  userIds.push(owner.id);
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: owner.id, role: 'owner' } });
  return { app: makeApp(), tenantId: tenant.id, ownerId: owner.id };
}

beforeAll(() => {
  originalSmtpEnv = Object.fromEntries(smtpEnvKeys.map((key) => [key, process.env[key]])) as Record<
    SmtpEnvKey,
    string | undefined
  >;
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = '1';
  process.env.SMTP_FROM = 'invites@meetropolis.test';
  process.env.SMTP_TLS_REJECT_UNAUTHORIZED = 'false';
  process.env.PUBLIC_BASE_URL = 'http://localhost:42000';
  process.env.PUBLIC_BASE_URL_ALLOW_LOOPBACK = 'true';
});

afterEach(async () => {
  const currentTenantIds = tenantIds.splice(0);
  const currentUserIds = userIds.splice(0);
  if (currentTenantIds.length) await prisma.invite.deleteMany({ where: { tenantId: { in: currentTenantIds } } });
  if (currentTenantIds.length || currentUserIds.length) {
    await prisma.membership.deleteMany({
      where: {
        OR: [
          ...(currentTenantIds.length ? [{ tenantId: { in: currentTenantIds } }] : []),
          ...(currentUserIds.length ? [{ userId: { in: currentUserIds } }] : []),
        ],
      },
    });
  }
  if (currentUserIds.length) {
    await prisma.emailVerification.deleteMany({ where: { userId: { in: currentUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: currentUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: currentUserIds } } });
  }
  if (currentTenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: currentTenantIds } } });
});

afterAll(async () => {
  await prisma.$disconnect();
  if (capturedLogs.originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = capturedLogs.originalNodeEnv;
  smtpEnvKeys.forEach((key) =>
    originalSmtpEnv[key] === undefined ? delete process.env[key] : (process.env[key] = originalSmtpEnv[key]),
  );
});

describe('undeliverable invitation', () => {
  it('takes the SMTP path and not the no-module path', async () => {
    const module = await getEmailModule();
    expect(module).not.toBeNull();
    const loaded = capturedLogs.events.find(
      (event) =>
        typeof event.value === 'object' &&
        event.value !== null &&
        (event.value as { event?: unknown }).event === 'email.module_loaded',
    );
    expect((loaded?.value as { provider?: unknown } | undefined)?.provider).toBe('oss-smtp');
  });

  it('reports an undeliverable invitation and keeps the link', async () => {
    const fixture = await createFixture();
    const email = `undelivered-${crypto.randomUUID()}@example.test`;
    const response = await request(fixture.app)
      .post('/auth/invite')
      .set('x-user', fixture.ownerId)
      .set('x-tenant', fixture.tenantId)
      .send({ email, role: 'member' });
    const body = response.body as InviteResponse;

    expect(response.status).toBe(200);
    expect(body.emailSent).toBe(false);
    expect(body.inviteUrl.startsWith('http://localhost:42000')).toBe(true);
    expect(body.expiresAt).toEqual(expect.any(String));
    expect(Number.isNaN(new Date(body.expiresAt as string).getTime())).toBe(false);

    expect(await prisma.invite.count({ where: { tenantId: fixture.tenantId, email } })).toBe(1);
    const row = await prisma.invite.findFirstOrThrow({ where: { tenantId: fixture.tenantId, email } });
    expect(row.lastSendError).toBe('not_delivered');
    expect(row.lastSentAt).toBeNull();
    expect(row.sendCount).toBe(0);
  });
});
