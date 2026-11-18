import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '../../db.js';
import { setAuthResolution } from '../utils/authState.js';
import { handleAuthForgot } from './auth.password.js';
import { handleAuthInvite } from './auth.signin.js';
import { registerAdminPasswordResetRoutes } from './admin.passwordReset.js';
import { registerGuestRoutes } from './guests.js';
import { registerMiscRoutes } from './misc.js';
import { hashInviteCode } from '../utils/inviteCode.js';

const capturedLogs = vi.hoisted(() => ({ events: [] as Array<{ level: string; value: unknown }> }));

vi.mock('../../logger.js', () => ({
  logger: {
    debug: (value: unknown) => capturedLogs.events.push({ level: 'debug', value }),
    error: (value: unknown) => capturedLogs.events.push({ level: 'error', value }),
    info: (value: unknown) => capturedLogs.events.push({ level: 'info', value }),
    warn: (value: unknown) => capturedLogs.events.push({ level: 'warn', value }),
  },
}));

// Mail-dependent routes resolve their provider through getEmailModule; the default
// is no provider, test A installs a delivering module to see the links it sends.
const mailDelivery = vi.hoisted(() => ({ module: null as null | Record<string, unknown> }));
vi.mock('../../emailLoader.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../emailLoader.js')>()),
  sendIfAvailable: vi.fn(() => Promise.resolve(false)),
  getEmailModule: vi.fn(() => Promise.resolve(mailDelivery.module)),
}));

function installDeliveringMailModule() {
  const sendRaw = vi.fn((_params: { to: string; text: string }) => Promise.resolve(true));
  const sent = () => Promise.resolve(true);
  mailDelivery.module = {
    version: 1,
    providerName: 'oss-smtp',
    sendInvite: sent,
    sendGuestInvite: sent,
    sendWelcome: sent,
    sendVerify: sent,
    sendRaw,
  };
  return sendRaw;
}

vi.mock('../../tenancyLoader.js', () => ({
  getTenancyModule: () => Promise.resolve({ isMultiTenantEnabled: () => true }),
}));

if (!process.env.DATABASE_URL) {
  throw new Error('publicLinks.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
const guestEmails: string[] = [];
const publicEnvKeys = ['PUBLIC_BASE_URL', 'BILLING_PUBLIC_URL', 'PUBLIC_BASE_URL_ALLOW_LOOPBACK'] as const;
type PublicEnvKey = (typeof publicEnvKeys)[number];
let originalPublicEnv: Record<PublicEnvKey, string | undefined>;

interface Fixture {
  app: express.Application;
  tenantId: string;
  adminId: string;
  targetId: string;
  targetEmail: string;
}

function makeApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const rawUser = req.headers['x-user'];
    const userId = typeof rawUser === 'string' ? rawUser : null;
    setAuthResolution(req, {
      auth: userId ? { userId, sessionId: `sess-${userId}`, tokenHash: `hash-${userId}` } : null,
    });
    const rawTenant = req.headers['x-tenant'];
    if (typeof rawTenant === 'string') {
      req.tenant = { id: rawTenant, slug: rawTenant, name: rawTenant } as never;
    }
    next();
  });
  registerGuestRoutes(app, prisma);
  app.post('/auth/invite', (req, res) => handleAuthInvite(prisma, req, res));
  registerMiscRoutes(app, prisma);
  registerAdminPasswordResetRoutes(app, prisma);
  app.post('/auth/forgot', (req, res) => handleAuthForgot(prisma, req, res));
  return app;
}

async function createFixture(): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const slug = `link-${suffix}`;
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);

  const admin = await prisma.user.create({ data: { email: `admin-${suffix}@example.test` } });
  const target = await prisma.user.create({
    data: { email: `target-${suffix}@example.test`, passwordHash: 'test-password-hash' },
  });
  userIds.push(admin.id, target.id);

  await prisma.membership.create({ data: { tenantId: tenant.id, userId: admin.id, role: 'admin' } });
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: target.id, role: 'member' } });

  return { app: makeApp(), tenantId: tenant.id, adminId: admin.id, targetId: target.id, targetEmail: target.email };
}

function setPublicEnv(values: Record<PublicEnvKey, string | undefined>): void {
  for (const key of publicEnvKeys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function waitForForgotToFinish(previousLogCount: number): Promise<void> {
  await vi.waitFor(() => {
    expect(capturedLogs.events.length).toBeGreaterThan(previousLogCount);
  });
}

async function createManualInvite(fixture: Fixture): Promise<string> {
  const code = crypto.randomUUID().replaceAll('-', '');
  const email = `listed-${crypto.randomUUID()}@example.test`;
  await prisma.invite.create({
    data: { code: hashInviteCode(code), email, createdBy: fixture.adminId, tenantId: fixture.tenantId, role: 'member' },
  });
  return email;
}

async function exerciseMissingBase(values: Record<PublicEnvKey, string | undefined>): Promise<void> {
  setPublicEnv(values);
  const fixture = await createFixture();
  const listedEmail = await createManualInvite(fixture);
  const inviteCountBefore = await prisma.invite.count({ where: { tenantId: fixture.tenantId } });
  const resetCountBefore = await prisma.passwordReset.count({ where: { userId: fixture.targetId } });
  const guestEmail = `guest-${crypto.randomUUID()}@example.test`;
  guestEmails.push(guestEmail);

  const guestResponse = await request(fixture.app)
    .post('/guests')
    .set('x-user', fixture.adminId)
    .set('x-tenant', fixture.tenantId)
    .set('Origin', 'https://web.example')
    .send({ email: guestEmail, name: 'Guest', expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() });
  const guestMemberships = await prisma.membership.findMany({
    where: { tenantId: fixture.tenantId, role: 'guest' },
    select: { id: true },
  });
  const guestTokenCountAfter = await prisma.guestToken.count({
    where: { membershipId: { in: guestMemberships.map(({ id }) => id) } },
  });

  const inviteResponse = await request(fixture.app)
    .post('/auth/invite')
    .set('x-user', fixture.adminId)
    .set('x-tenant', fixture.tenantId)
    .set('Origin', 'https://web.example')
    .send({ email: `invite-${crypto.randomUUID()}@example.test`, role: 'member' });
  const inviteCountAfter = await prisma.invite.count({ where: { tenantId: fixture.tenantId } });

  const listResponse = await request(fixture.app)
    .get('/invites')
    .set('x-user', fixture.adminId)
    .set('x-tenant', fixture.tenantId);
  const listedInvite = (listResponse.body as Array<{ email: string | null; url?: string | null }>).find(
    ({ email }) => email === listedEmail,
  );

  const resetResponse = await request(fixture.app)
    .post(`/admin/users/${fixture.targetId}/reset-token`)
    .set('x-user', fixture.adminId)
    .set('x-tenant', fixture.tenantId)
    .set('Origin', 'https://web.example');
  const resetCountAfterAdmin = await prisma.passwordReset.count({ where: { userId: fixture.targetId } });

  const logsBeforeForgot = capturedLogs.events.length;
  const forgotResponse = await request(fixture.app).post('/auth/forgot').send({ email: fixture.targetEmail });
  await waitForForgotToFinish(logsBeforeForgot);
  const resetCountAfterForgot = await prisma.passwordReset.count({ where: { userId: fixture.targetId } });

  expect.soft(guestResponse.status).toBe(500);
  expect.soft(guestResponse.body).toEqual({ error: 'public_base_url_missing' });
  expect.soft(guestTokenCountAfter).toBe(0);
  expect.soft(inviteResponse.status).toBe(500);
  expect.soft(inviteResponse.body).toEqual({ error: 'public_base_url_missing' });
  expect.soft(inviteCountAfter - inviteCountBefore).toBe(0);
  expect.soft(listedInvite?.url).toBeUndefined();
  expect.soft(resetResponse.status).toBe(500);
  expect.soft(resetResponse.body).toEqual({ error: 'public_base_url_missing' });
  expect.soft(resetCountAfterAdmin - resetCountBefore).toBe(0);
  expect.soft(forgotResponse.status).toBe(200);
  expect.soft(resetCountAfterForgot - resetCountBefore).toBe(0);
}

beforeEach(() => {
  originalPublicEnv = Object.fromEntries(publicEnvKeys.map((key) => [key, process.env[key]])) as Record<
    PublicEnvKey,
    string | undefined
  >;
  capturedLogs.events.length = 0;
  mailDelivery.module = null;
});

afterEach(async () => {
  const currentTenantIds = tenantIds.splice(0);
  const currentUserIds = userIds.splice(0);
  const currentGuestEmails = guestEmails.splice(0);
  const extraUsers = currentGuestEmails.length
    ? await prisma.user.findMany({ where: { email: { in: currentGuestEmails } }, select: { id: true } })
    : [];
  const allUserIds = [...currentUserIds, ...extraUsers.map(({ id }) => id)];
  const memberships = currentTenantIds.length
    ? await prisma.membership.findMany({ where: { tenantId: { in: currentTenantIds } }, select: { id: true } })
    : [];

  if (currentTenantIds.length) {
    await prisma.invite.deleteMany({ where: { tenantId: { in: currentTenantIds } } });
  }
  if (memberships.length) {
    await prisma.guestToken.deleteMany({ where: { membershipId: { in: memberships.map(({ id }) => id) } } });
  }
  if (allUserIds.length) {
    await prisma.passwordReset.deleteMany({ where: { userId: { in: allUserIds } } });
    await prisma.emailVerification.deleteMany({ where: { userId: { in: allUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: allUserIds } } });
  }
  if (currentTenantIds.length || allUserIds.length) {
    await prisma.membership.deleteMany({
      where: {
        OR: [
          ...(currentTenantIds.length ? [{ tenantId: { in: currentTenantIds } }] : []),
          ...(allUserIds.length ? [{ userId: { in: allUserIds } }] : []),
        ],
      },
    });
  }
  if (allUserIds.length) await prisma.user.deleteMany({ where: { id: { in: allUserIds } } });
  if (currentTenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: currentTenantIds } } });

  for (const key of publicEnvKeys) {
    const value = originalPublicEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('public web links (real database)', () => {
  it('A: uses PUBLIC_BASE_URL even when the request Origin is native', async () => {
    setPublicEnv({
      PUBLIC_BASE_URL: 'https://public.example/',
      BILLING_PUBLIC_URL: undefined,
      PUBLIC_BASE_URL_ALLOW_LOOPBACK: undefined,
    });
    const fixture = await createFixture();
    const sendRaw = installDeliveringMailModule();
    const guestEmail = `guest-${crypto.randomUUID()}@example.test`;
    guestEmails.push(guestEmail);

    const guest = await request(fixture.app)
      .post('/guests')
      .set('x-user', fixture.adminId)
      .set('x-tenant', fixture.tenantId)
      .set('Origin', 'tauri://localhost')
      .send({ email: guestEmail, name: 'Guest', expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() });
    const inviteEmail = `invite-${crypto.randomUUID()}@example.test`;
    const invite = await request(fixture.app)
      .post('/auth/invite')
      .set('x-user', fixture.adminId)
      .set('x-tenant', fixture.tenantId)
      .set('Origin', 'tauri://localhost')
      .send({ email: inviteEmail, role: 'member' });
    const listed = await request(fixture.app)
      .get('/invites')
      .set('x-user', fixture.adminId)
      .set('x-tenant', fixture.tenantId);
    const listedInvite = (listed.body as Array<{ email: string | null; url?: string | null }>).find(
      ({ email }) => email === inviteEmail,
    );
    const reset = await request(fixture.app)
      .post(`/admin/users/${fixture.targetId}/reset-token`)
      .set('x-user', fixture.adminId)
      .set('x-tenant', fixture.tenantId)
      .set('Origin', 'tauri://localhost');
    const logsBeforeForgot = capturedLogs.events.length;
    const forgot = await request(fixture.app).post('/auth/forgot').send({ email: fixture.targetEmail });
    await waitForForgotToFinish(logsBeforeForgot);
    const resetTokenCount = await prisma.passwordReset.count({ where: { userId: fixture.targetId } });

    expect.soft(guest.status).toBe(200);
    expect.soft(guest.body.magicLink.startsWith('https://public.example/#/guest?token=')).toBe(true);
    expect.soft(invite.status).toBe(200);
    expect.soft(invite.body.inviteUrl).toBe(`https://public.example/#/?invite=${invite.body.code}`);
    expect.soft(listedInvite?.url).toBeUndefined();
    // A tenant admin reset only mails the link, so the link is checked in the mails that left.
    const resetMails = sendRaw.mock.calls.map(([params]) => params).filter(({ to }) => to === fixture.targetEmail);
    expect.soft(reset.status).toBe(200);
    expect.soft(reset.body).toEqual({ ok: true, sent: true });
    expect.soft(resetMails).toHaveLength(2);
    expect.soft(resetMails.every(({ text }) => text.includes('https://public.example/#/reset?token='))).toBe(true);
    expect.soft(forgot.status).toBe(200);
    expect.soft(resetTokenCount).toBeGreaterThan(0);
  });

  it('B: does not fall back to BILLING_PUBLIC_URL or the request Origin', async () => {
    await exerciseMissingBase({
      PUBLIC_BASE_URL: undefined,
      BILLING_PUBLIC_URL: 'https://billing.example',
      PUBLIC_BASE_URL_ALLOW_LOOPBACK: undefined,
    });
  });

  it.each(['tauri://localhost', 'http://tauri.localhost', 'http://localhost:5173'] as const)(
    'C: rejects invalid configured base %s without the loopback switch',
    async (publicBaseUrl) => {
      await exerciseMissingBase({
        PUBLIC_BASE_URL: publicBaseUrl,
        BILLING_PUBLIC_URL: undefined,
        PUBLIC_BASE_URL_ALLOW_LOOPBACK: undefined,
      });
    },
  );

  it('D: permits a loopback PUBLIC_BASE_URL when the explicit switch is true', async () => {
    setPublicEnv({
      PUBLIC_BASE_URL: 'http://localhost:42040',
      BILLING_PUBLIC_URL: undefined,
      PUBLIC_BASE_URL_ALLOW_LOOPBACK: 'true',
    });
    const fixture = await createFixture();
    const invite = await request(fixture.app)
      .post('/auth/invite')
      .set('x-user', fixture.adminId)
      .set('x-tenant', fixture.tenantId)
      .send({ email: `invite-${crypto.randomUUID()}@example.test`, role: 'member' });

    expect(invite.status).toBe(200);
    expect(invite.body.inviteUrl).toBe(`http://localhost:42040/#/?invite=${invite.body.code}`);
  });
});
