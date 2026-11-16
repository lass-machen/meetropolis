import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '../../db.js';
import { setAuthResolution } from '../utils/authState.js';
import { handleAuthInvite, handleAuthRegister } from './auth.signin.js';
import { registerMiscRoutes } from './misc.js';
import { registerGuestRoutes } from './guests.js';
import { formatInviteExpiry } from '../utils/inviteLifecycle.js';

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

if (!process.env.DATABASE_URL) throw new Error('invites.integration.test.ts needs DATABASE_URL');
if (!process.env.MAILPIT_URL || !process.env.MAILPIT_SMTP_HOST || !process.env.MAILPIT_SMTP_PORT) {
  throw new Error('invites.integration.test.ts needs MAILPIT_URL, MAILPIT_SMTP_HOST, and MAILPIT_SMTP_PORT');
}

const prisma = createPrismaClient();
const mailpitUrl = process.env.MAILPIT_URL.replace(/\/$/, '');
const tenantIds: string[] = [];
const userIds: string[] = [];
const inviteFields = 'id,email,role,status,expiresAt,lastSentAt,lastSendError,createdAt,usedAt,url'.split(',').sort();
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
let membershipTrigger: MembershipTrigger | null = null;

interface Fixture {
  app: express.Application;
  tenantId: string;
  ownerId: string;
  adminId: string;
  memberId: string;
}

interface InviteResponse {
  code: string;
  role: string;
  inviteUrl: string;
  expiresAt: string;
  emailSent: boolean;
}

interface InviteLifecycleRow {
  expiresAt: Date | null;
  lastSentAt: Date | null;
  sendCount: number;
  lastSendError: string | null;
}

interface MembershipTrigger {
  functionName: string;
  triggerName: string;
  tableName: string;
}

interface ListedInvite {
  id: string;
  status: string;
  expiresAt: string | null;
  lastSendError: string | null;
  url: string | null;
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
  app.post('/auth/register', (req, res) => handleAuthRegister(prisma, req, res));
  registerMiscRoutes(app, prisma);
  registerGuestRoutes(app, prisma);
  return app;
}

async function createFixture(): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const tenant = await prisma.tenant.create({ data: { slug: `invites-${suffix}`, name: `Invites ${suffix}` } });
  tenantIds.push(tenant.id);
  const owner = await prisma.user.create({ data: { email: `owner-${suffix}@example.test` } });
  const admin = await prisma.user.create({ data: { email: `admin-${suffix}@example.test` } });
  const member = await prisma.user.create({ data: { email: `member-${suffix}@example.test` } });
  userIds.push(owner.id, admin.id, member.id);
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: owner.id, role: 'owner' } });
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: admin.id, role: 'admin' } });
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: member.id, role: 'member' } });
  return { app: makeApp(), tenantId: tenant.id, ownerId: owner.id, adminId: admin.id, memberId: member.id };
}

function inviteRequest(fixture: Fixture, userId: string, email: string, role: string) {
  return request(fixture.app)
    .post('/auth/invite')
    .set('x-user', userId)
    .set('x-tenant', fixture.tenantId)
    .send({ email, role });
}

function inviteAction(fixture: Fixture, userId: string, method: 'delete' | 'post', path: string) {
  const action = method === 'delete' ? request(fixture.app).delete(path) : request(fixture.app).post(path);
  return action.set('x-user', userId).set('x-tenant', fixture.tenantId);
}

const listInvites = (fixture: Fixture, userId: string) =>
  request(fixture.app).get('/invites').set('x-user', userId).set('x-tenant', fixture.tenantId);

async function inviteLifecycle(code: string): Promise<InviteLifecycleRow> {
  const rows = await prisma.$queryRaw<InviteLifecycleRow[]>`
    SELECT "expiresAt", "lastSentAt", "sendCount", "lastSendError" FROM "Invite" WHERE "code" = ${code}
  `;
  if (!rows[0]) throw new Error('Expected invite lifecycle row');
  return rows[0];
}

async function createInviteRecord(
  fixture: Fixture,
  email: string | null,
  tenantId = fixture.tenantId,
  role = 'member',
) {
  return prisma.invite.create({
    data: {
      code: crypto.randomUUID().replaceAll('-', ''),
      email,
      createdBy: fixture.ownerId,
      tenantId,
      role,
    },
  });
}

async function createActiveInvite(fixture: Fixture, email: string, role = 'member') {
  const invite = await createInviteRecord(fixture, email, fixture.tenantId, role);
  await prisma.$executeRaw`
    UPDATE "Invite" SET "expiresAt" = now() + interval '7 days' WHERE "id" = ${invite.id}
  `;
  return invite;
}

async function createAccount(email: string, name: string) {
  const user = await prisma.user.create({ data: { email, name } });
  userIds.push(user.id);
  return user;
}

function previewInvite(fixture: Fixture, code?: string) {
  return request(fixture.app)
    .post('/public/invites/preview')
    .send(code === undefined ? {} : { code });
}

function acceptInvite(fixture: Fixture, code?: string, userId?: string) {
  const action = request(fixture.app).post('/invites/accept');
  if (userId) action.set('x-user', userId);
  return action.send(code === undefined ? {} : { code });
}

async function rejectInviteBindingInsert(inviteId: string): Promise<void> {
  const suffix = crypto.randomUUID().replaceAll('-', '');
  const functionName = `qacc_reject_binding_${suffix}`;
  const triggerName = `qacc_reject_binding_insert_${suffix}`;
  membershipTrigger = { functionName, triggerName, tableName: 'EmailVerification' };
  await prisma.$executeRawUnsafe(`
CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
IF NEW."inviteId" = '${inviteId}' THEN RAISE EXCEPTION 'test invite binding failure'; END IF;
RETURN NEW;
END;
$$
`);
  await prisma.$executeRawUnsafe(`
CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "EmailVerification"
FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
`);
}

async function rejectMembershipInsertForTenant(tenantId: string): Promise<void> {
  const suffix = crypto.randomUUID().replaceAll('-', '');
  const functionName = `sample_reject_membership_${suffix}`;
  const triggerName = `sample_reject_insert_${suffix}`;
  membershipTrigger = { functionName, triggerName, tableName: 'Membership' };
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."tenantId" = '${tenantId}' THEN RAISE EXCEPTION 'test membership failure'; END IF;
      RETURN NEW;
    END;
    $$
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "Membership"
    FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
  `);
}

async function createForeignInvite(fixture: Fixture, email: string) {
  const tenant = await prisma.tenant.create({ data: { slug: `foreign-${crypto.randomUUID()}`, name: 'Foreign' } });
  tenantIds.push(tenant.id);
  return createInviteRecord(fixture, email, tenant.id);
}

async function inviteByCode(code: string) {
  const invite = await prisma.invite.findUnique({ where: { code } });
  if (!invite) throw new Error('Expected invite row');
  return invite;
}

function registerInvite(fixture: Fixture, code: string, email: string, name = 'Registered Invitee') {
  return request(fixture.app)
    .post('/auth/register')
    .send({ code, email, name, password: 'case-registration-password' });
}

async function waitForEmailVerification(email: string): Promise<void> {
  await vi.waitFor(
    async () => {
      expect(await prisma.emailVerification.count({ where: { user: { email } } })).toBe(2);
    },
    { timeout: 10_000 },
  );
}

async function waitForMail(to: string, minimumCount = 1): Promise<{ text: string; count: number }> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const query = new URLSearchParams({ query: `to:"${to}"` });
    const search = await fetch(`${mailpitUrl}/api/v1/search?${query.toString()}`);
    if (!search.ok) throw new Error('Mailpit search request failed');
    const result = (await search.json()) as { messages_count?: number; messages?: Array<{ ID: string }> };
    const count = result.messages_count ?? result.messages?.length ?? 0;
    const latest = result.messages?.[0];
    if (count >= minimumCount && latest) {
      const detail = await fetch(`${mailpitUrl}/api/v1/message/${latest.ID}`);
      if (!detail.ok) throw new Error('Mailpit message request failed');
      const message = (await detail.json()) as { Text: string };
      return { text: message.Text, count };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mailpit did not receive ${minimumCount} invitation message(s)`);
}

beforeAll(() => {
  originalSmtpEnv = Object.fromEntries(smtpEnvKeys.map((key) => [key, process.env[key]])) as Record<
    SmtpEnvKey,
    string | undefined
  >;
  process.env.SMTP_HOST = process.env.MAILPIT_SMTP_HOST;
  process.env.SMTP_PORT = process.env.MAILPIT_SMTP_PORT;
  process.env.SMTP_FROM = 'invites@meetropolis.test';
  process.env.SMTP_TLS_REJECT_UNAUTHORIZED = 'false';
  process.env.PUBLIC_BASE_URL = 'http://localhost:42000';
  process.env.PUBLIC_BASE_URL_ALLOW_LOOPBACK = 'true';
});

afterEach(async () => {
  if (membershipTrigger) {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${membershipTrigger.triggerName}" ON "${membershipTrigger.tableName}"`,
    );
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${membershipTrigger.functionName}"()`);
    membershipTrigger = null;
  }
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
    await prisma.authEvent.deleteMany({ where: { userId: { in: currentUserIds } } });
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

describe('invite delivery feedback and open invite reuse', () => {
  it('delivers, records success, reuses an open invite, and rejects an existing member', async () => {
    const fixture = await createFixture();
    const email = `invite-${crypto.randomUUID()}@example.test`;
    const startedAt = Date.now();
    const firstResponse = await inviteRequest(fixture, fixture.ownerId, email, 'admin');
    const first = firstResponse.body as InviteResponse;
    expect(firstResponse.status).toBe(200);
    expect(first.emailSent).toBe(true);
    expect(first.inviteUrl).toBe(`http://localhost:42000/#/?invite=${first.code}`);
    expect(new Date(first.expiresAt).getTime() - startedAt).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -3);
    const firstMail = await waitForMail(email);
    expect(firstMail.text).toContain(first.inviteUrl);
    expect(firstMail.text).toContain(
      new Date(first.expiresAt).toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Berlin',
        timeZoneName: 'short',
      }),
    );
    const firstRow = await inviteLifecycle(first.code);
    expect(firstRow.lastSentAt).toBeInstanceOf(Date);
    expect(firstRow.sendCount).toBe(1);
    expect(firstRow.lastSendError).toBeNull();

    const secondResponse = await inviteRequest(fixture, fixture.ownerId, email, 'member');
    const second = secondResponse.body as InviteResponse;
    const secondMail = await waitForMail(email, 2);
    const secondRow = await inviteLifecycle(first.code);
    expect(secondResponse.status).toBe(200);
    expect(second.code).toBe(first.code);
    expect(second.role).toBe('member');
    expect(secondMail.count).toBe(2);
    expect(await prisma.invite.count({ where: { tenantId: fixture.tenantId, email } })).toBe(1);
    expect(secondRow.sendCount).toBe(2);
    expect(secondRow.expiresAt!.getTime()).toBeGreaterThan(firstRow.expiresAt!.getTime());

    const existing = await prisma.user.create({ data: { email: `existing-${crypto.randomUUID()}@example.test` } });
    userIds.push(existing.id);
    await prisma.membership.create({ data: { tenantId: fixture.tenantId, userId: existing.id, role: 'member' } });
    const before = await prisma.invite.count({ where: { tenantId: fixture.tenantId } });
    const rejected = await inviteRequest(fixture, fixture.ownerId, existing.email, 'member');
    expect(rejected.status).toBe(409);
    expect(rejected.body).toEqual({ error: 'already_member' });
    expect(await prisma.invite.count({ where: { tenantId: fixture.tenantId } })).toBe(before);
  });
});

describe('invite expiry, status, and resend', () => {
  it('lists the exact projection and expires open invites with a NULL expiry', async () => {
    const fixture = await createFixture();
    const pending = await createInviteRecord(fixture, `pending-${crypto.randomUUID()}@example.test`);
    const expired = await createInviteRecord(fixture, `expired-${crypto.randomUUID()}@example.test`);
    const accepted = await createInviteRecord(fixture, `accepted-${crypto.randomUUID()}@example.test`);
    const nullExpiry = await createInviteRecord(fixture, `null-${crypto.randomUUID()}@example.test`);
    await prisma.$executeRaw`
      UPDATE "Invite" SET "expiresAt" = now() + interval '2 days', "lastSentAt" = now(),
        "lastSendError" = 'not_delivered' WHERE "code" = ${pending.code}
    `;
    await prisma.$executeRaw`UPDATE "Invite" SET "expiresAt" = now() - interval '1 day' WHERE "code" = ${expired.code}`;
    await prisma.$executeRaw`UPDATE "Invite" SET "usedAt" = now() WHERE "code" = ${accepted.code}`;

    const response = await listInvites(fixture, fixture.ownerId);
    const invites = response.body as ListedInvite[];
    const listedPending = invites.find(({ id }) => id === pending.id);
    const listedExpired = invites.find(({ id }) => id === expired.id);
    const listedAccepted = invites.find(({ id }) => id === accepted.id);
    const listedNullExpiry = invites.find(({ id }) => id === nullExpiry.id);

    expect(response.status).toBe(200);
    expect(Object.keys(listedPending ?? {}).sort()).toEqual(inviteFields);
    expect(listedPending).toMatchObject({ id: pending.id, status: 'pending', lastSendError: 'not_delivered' });
    expect(listedPending?.url).toContain(`?invite=${pending.code}`);
    expect(listedExpired).toMatchObject({ id: expired.id, status: 'expired' });
    expect(listedAccepted).toMatchObject({ id: accepted.id, status: 'accepted' });
    expect(listedNullExpiry).toMatchObject({ id: nullExpiry.id, status: 'expired', expiresAt: null });
  });

  it('resends a past-expiry invite by ID and updates its lifecycle', async () => {
    const fixture = await createFixture();
    const email = `resend-${crypto.randomUUID()}@example.test`;
    const firstResponse = await inviteRequest(fixture, fixture.ownerId, email, 'member');
    const first = firstResponse.body as InviteResponse;
    expect(first.emailSent).toBe(true);
    await waitForMail(email);
    const invite = await inviteByCode(first.code);
    await prisma.$executeRaw`UPDATE "Invite" SET "expiresAt" = now() - interval '1 day' WHERE "code" = ${first.code}`;
    const before = await inviteLifecycle(first.code);

    const resentResponse = await inviteAction(fixture, fixture.ownerId, 'post', `/invites/${invite.id}/resend`);
    const resent = resentResponse.body as InviteResponse;
    await waitForMail(email, 2);
    const after = await inviteLifecycle(first.code);
    expect(resentResponse.status).toBe(200);
    expect(Object.keys(resent).sort()).toEqual(['code', 'role', 'inviteUrl', 'expiresAt', 'emailSent'].sort());
    expect(resent.code).toBe(first.code);
    expect(new Date(resent.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(resent.emailSent).toBe(true);
    expect(after.sendCount).toBe(before.sendCount + 1);
    expect(after.lastSentAt).toBeInstanceOf(Date);
    expect(after.lastSendError).toBeNull();

    const listed = await listInvites(fixture, fixture.ownerId);
    expect((listed.body as ListedInvite[]).find(({ id }) => id === invite.id)?.status).toBe('pending');
  });

  it('resends an invite with NULL expiry and restores its pending status', async () => {
    const fixture = await createFixture();
    const email = `null-expiry-${crypto.randomUUID()}@example.test`;
    const first = (await inviteRequest(fixture, fixture.ownerId, email, 'member')).body as InviteResponse;
    const invite = await inviteByCode(first.code);
    await waitForMail(email);
    await prisma.$executeRaw`UPDATE "Invite" SET "expiresAt" = NULL WHERE "id" = ${invite.id}`;
    const before = await inviteLifecycle(first.code);

    const response = await inviteAction(fixture, fixture.ownerId, 'post', `/invites/${invite.id}/resend`);
    const resent = response.body as InviteResponse;
    await waitForMail(email, 2);
    const after = await inviteLifecycle(first.code);
    const listed = await listInvites(fixture, fixture.ownerId);
    expect(response.status).toBe(200);
    expect(resent.code).toBe(first.code);
    expect(new Date(resent.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(resent.emailSent).toBe(true);
    expect(after.sendCount).toBe(before.sendCount + 1);
    expect((listed.body as ListedInvite[]).find(({ id }) => id === invite.id)?.status).toBe('pending');
  });

  it('rejects a code-shaped revocation ID with 400 and preserves its row and mail count', async () => {
    const fixture = await createFixture();
    const email = `old-client-${crypto.randomUUID()}@example.test`;
    const created = await inviteRequest(fixture, fixture.ownerId, email, 'member');
    const invite = await inviteByCode((created.body as InviteResponse).code);
    await waitForMail(email);
    await prisma.$executeRaw`UPDATE "Invite" SET "expiresAt" = NULL WHERE "id" = ${invite.id}`;
    const before = await inviteLifecycle(invite.code);
    const rowCount = await prisma.invite.count({ where: { tenantId: fixture.tenantId } });

    const deleted = await inviteAction(fixture, fixture.ownerId, 'delete', `/invites/${invite.code}`);
    const resent = await inviteAction(fixture, fixture.ownerId, 'post', `/invites/${invite.code}/resend`);
    expect(deleted.status).toBe(400);
    expect(deleted.body).toEqual({
      code: 'invite_id_invalid',
      error: 'Update the application and use the current invitation list to revoke invitations.',
    });
    expect(resent.status).toBe(404);
    expect(resent.body).toEqual({ error: 'not found' });
    expect(await prisma.invite.findUnique({ where: { id: invite.id } })).not.toBeNull();
    expect(await prisma.invite.count({ where: { tenantId: fixture.tenantId } })).toBe(rowCount);
    expect(await inviteLifecycle(invite.code)).toEqual(before);
    expect((await waitForMail(email, 1)).count).toBe(1);
  });

  it('rejects used, unknown, foreign, and member resends', async () => {
    const fixture = await createFixture();
    const used = await createInviteRecord(fixture, `used-${crypto.randomUUID()}@example.test`);
    await prisma.$executeRaw`UPDATE "Invite" SET "usedAt" = now() WHERE "code" = ${used.code}`;
    const usedResponse = await inviteAction(fixture, fixture.ownerId, 'post', `/invites/${used.id}/resend`);
    expect(usedResponse.status).toBe(400);
    expect(usedResponse.body).toEqual({ error: 'already used' });

    const missingResponse = await inviteAction(fixture, fixture.ownerId, 'post', '/invites/unknown-id/resend');
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.body).toEqual({ error: 'not found' });

    const foreignInvite = await createForeignInvite(fixture, `foreign-${crypto.randomUUID()}@example.test`);
    const foreignResponse = await inviteAction(fixture, fixture.ownerId, 'post', `/invites/${foreignInvite.id}/resend`);
    expect(foreignResponse.status).toBe(404);
    expect(foreignResponse.body).toEqual({ error: 'not found' });

    const memberResponse = await inviteAction(fixture, fixture.memberId, 'post', `/invites/${used.id}/resend`);
    expect(memberResponse.status).toBe(403);
    expect(memberResponse.body).toEqual({ error: 'forbidden' });
  });

  it('deletes by ID and returns 404 for an invite in another tenant', async () => {
    const fixture = await createFixture();
    const invite = await createInviteRecord(fixture, `delete-${crypto.randomUUID()}@example.test`);
    const deleted = await inviteAction(fixture, fixture.ownerId, 'delete', `/invites/${invite.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true });
    expect(await prisma.invite.findUnique({ where: { id: invite.id } })).toBeNull();

    const foreign = await createForeignInvite(fixture, `foreign-delete-${crypto.randomUUID()}@example.test`);
    const foreignResponse = await inviteAction(fixture, fixture.ownerId, 'delete', `/invites/${foreign.id}`);
    expect(foreignResponse.status).toBe(404);
    expect(foreignResponse.body).toEqual({ error: 'not found' });
    expect(await prisma.invite.findUnique({ where: { id: foreign.id } })).not.toBeNull();
  });
});

describe('invite list and revoke require tenant admins', () => {
  it('denies list and revoke to a plain member without changing the invite', async () => {
    const fixture = await createFixture();
    const invite = await createInviteRecord(fixture, `member-access-${crypto.randomUUID()}@example.test`);

    const listed = await listInvites(fixture, fixture.memberId);
    const deleted = await inviteAction(fixture, fixture.memberId, 'delete', `/invites/${invite.id}`);

    expect(listed.status).toBe(403);
    expect(listed.body).toEqual({ error: 'forbidden' });
    expect(deleted.status).toBe(403);
    expect(deleted.body).toEqual({ error: 'forbidden' });
    expect(await prisma.invite.findUnique({ where: { id: invite.id } })).not.toBeNull();
  });

  it('allows admins and owners to list and revoke pending and expired invites', async () => {
    const fixture = await createFixture();
    const pending = await createInviteRecord(fixture, `pending-${crypto.randomUUID()}@example.test`);
    const expired = await createInviteRecord(fixture, `expired-${crypto.randomUUID()}@example.test`);
    const accepted = await createInviteRecord(fixture, `accepted-${crypto.randomUUID()}@example.test`);
    await prisma.$executeRaw`UPDATE "Invite" SET "expiresAt" = now() + interval '2 days' WHERE "id" = ${pending.id}`;
    await prisma.$executeRaw`UPDATE "Invite" SET "expiresAt" = now() - interval '1 day' WHERE "id" = ${expired.id}`;
    await prisma.$executeRaw`UPDATE "Invite" SET "usedAt" = now() WHERE "id" = ${accepted.id}`;

    expect((await listInvites(fixture, fixture.adminId)).status).toBe(200);
    expect((await listInvites(fixture, fixture.ownerId)).status).toBe(200);
    const deletedPending = await inviteAction(fixture, fixture.adminId, 'delete', `/invites/${pending.id}`);
    const deletedExpired = await inviteAction(fixture, fixture.ownerId, 'delete', `/invites/${expired.id}`);
    const deletedAccepted = await inviteAction(fixture, fixture.adminId, 'delete', `/invites/${accepted.id}`);

    expect(deletedPending.status).toBe(200);
    expect(deletedExpired.status).toBe(200);
    expect(deletedAccepted.status).toBe(400);
    expect(deletedAccepted.body).toEqual({ error: 'already used' });
  });
});

describe('bound invites for existing accounts', () => {
  it('previews a public invite with only the documented fields and validates the code', async () => {
    const fixture = await createFixture();
    const invite = await createActiveInvite(fixture, `x-${crypto.randomUUID()}@example.test`);

    const preview = await previewInvite(fixture, invite.code);
    expect(preview.status).toBe(200);
    expect(Object.keys(preview.body).sort()).toEqual(['tenantName', 'role', 'status', 'emailMasked'].sort());
    expect(preview.body).toEqual({
      tenantName: expect.any(String),
      role: 'member',
      status: 'pending',
      emailMasked: 'x***@example.test',
    });
    expect((await previewInvite(fixture, 'unknown-code')).status).toBe(404);
    expect((await previewInvite(fixture)).status).toBe(400);
    expect((await previewInvite(fixture, 'abc')).status).toBe(400);
  });

  it('checks authentication, schema, existence, status, and bound email in order', async () => {
    const fixture = await createFixture();
    const boundEmail = `bound-${crypto.randomUUID()}@example.test`;
    const mismatch = await createAccount(`other-${crypto.randomUUID()}@example.test`, 'Other Account');
    const invite = await createActiveInvite(fixture, boundEmail);
    const expired = await createActiveInvite(fixture, `expired-${crypto.randomUUID()}@example.test`);
    const used = await createActiveInvite(fixture, `used-${crypto.randomUUID()}@example.test`);
    await prisma.$executeRaw`UPDATE "Invite" SET "expiresAt" = now() - interval '1 day' WHERE "id" = ${expired.id}`;
    await prisma.invite.update({ where: { id: used.id }, data: { usedAt: new Date() } });

    expect((await acceptInvite(fixture, undefined)).status).toBe(401);
    expect((await acceptInvite(fixture, undefined, fixture.ownerId)).status).toBe(400);
    expect((await acceptInvite(fixture, 'unknown-code', fixture.ownerId)).status).toBe(404);
    const mismatched = await acceptInvite(fixture, invite.code, mismatch.id);
    expect(mismatched.status).toBe(403);
    expect(mismatched.body).toEqual({ error: 'invite_email_mismatch' });
    expect((await acceptInvite(fixture, expired.code, fixture.ownerId)).status).toBe(409);
    expect((await acceptInvite(fixture, used.code, fixture.ownerId)).status).toBe(409);
    expect(
      await prisma.invite.findUnique({ where: { id: invite.id }, select: { usedAt: true, usedById: true } }),
    ).toEqual({
      usedAt: null,
      usedById: null,
    });
    expect(await prisma.membership.count({ where: { tenantId: fixture.tenantId, userId: mismatch.id } })).toBe(0);
  });

  it('accepts a matching account, creates its membership, consumes the invite, and sets a session cookie', async () => {
    const fixture = await createFixture();
    const email = `accept-${crypto.randomUUID()}@example.test`;
    const account = await createAccount(email, 'Invitee Name');
    const invite = await createActiveInvite(fixture, email, 'admin');
    await prisma.user.update({ where: { id: account.id }, data: { emailVerifiedAt: new Date() } });

    const response = await acceptInvite(fixture, invite.code, account.id);
    const membership = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: fixture.tenantId, userId: account.id } },
    });
    const used = await prisma.invite.findUnique({ where: { id: invite.id }, select: { usedAt: true, usedById: true } });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: account.id, email, name: 'Invitee Name', alreadyMember: false });
    expect(membership).toMatchObject({ role: 'admin' });
    expect(used).toMatchObject({ usedAt: expect.any(Date), usedById: account.id });
    expect(response.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringContaining('auth_token=')]));
  });

  it('records an invite_accept auth event for the accepting account and tenant', async () => {
    const fixture = await createFixture();
    const email = `event-${crypto.randomUUID()}@example.test`;
    const account = await createAccount(email, 'Event Invitee');
    const invite = await createActiveInvite(fixture, email, 'member');
    await prisma.user.update({ where: { id: account.id }, data: { emailVerifiedAt: new Date() } });

    const response = await acceptInvite(fixture, invite.code, account.id);

    expect(response.status).toBe(200);
    const events = await prisma.authEvent.findMany({ where: { userId: account.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'invite_accept', success: true, tenantId: fixture.tenantId });
  });

  it('consumes an invite for an existing member without changing that member role', async () => {
    const fixture = await createFixture();
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: fixture.ownerId } });
    const invite = await createActiveInvite(fixture, owner.email, 'member');
    await prisma.user.update({ where: { id: owner.id }, data: { emailVerifiedAt: new Date() } });

    const response = await acceptInvite(fixture, invite.code, owner.id);
    const membership = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: fixture.tenantId, userId: owner.id } },
    });

    expect(response.status).toBe(200);
    expect(response.body.alreadyMember).toBe(true);
    expect(membership?.role).toBe('owner');
    expect(await prisma.invite.findUnique({ where: { id: invite.id }, select: { usedById: true } })).toEqual({
      usedById: owner.id,
    });
  });

  it('allows only one of five parallel requests to consume an invite', async () => {
    const fixture = await createFixture();
    const account = await createAccount(`parallel-${crypto.randomUUID()}@example.test`, 'Parallel Invitee');
    const invite = await createActiveInvite(fixture, account.email);
    await prisma.user.update({ where: { id: account.id }, data: { emailVerifiedAt: new Date() } });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => acceptInvite(fixture, invite.code, account.id)),
    );

    expect(responses.filter(({ status }) => status === 200)).toHaveLength(1);
    expect(responses.filter(({ status }) => status === 409)).toHaveLength(4);
  });

  it('rolls back invite consumption when membership creation fails', async () => {
    const fixture = await createFixture();
    const account = await createAccount(`rollback-${crypto.randomUUID()}@example.test`, 'Rollback Invitee');
    const invite = await createActiveInvite(fixture, account.email);
    await rejectMembershipInsertForTenant(fixture.tenantId);
    await prisma.user.update({ where: { id: account.id }, data: { emailVerifiedAt: new Date() } });

    const response = await acceptInvite(fixture, invite.code, account.id);
    const row = await prisma.invite.findUnique({ where: { id: invite.id }, select: { usedAt: true, usedById: true } });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'accept_failed' });
    expect(row).toEqual({ usedAt: null, usedById: null });
    expect(await prisma.membership.count({ where: { tenantId: fixture.tenantId, userId: account.id } })).toBe(0);
  });
});

describe('atomic registration with an invite code', () => {
  it('returns invite_unavailable for unknown and already-used invitations', async () => {
    const fixture = await createFixture();
    const email = `unavailable-${crypto.randomUUID()}@example.test`;
    const used = await createActiveInvite(fixture, email);
    await prisma.invite.update({ where: { id: used.id }, data: { usedAt: new Date() } });

    const unknown = await registerInvite(fixture, 'unknown-code', email);
    const accepted = await registerInvite(fixture, used.code, email);

    expect(unknown.status).toBe(400);
    expect(unknown.body).toEqual({ error: 'invite_unavailable' });
    expect(accepted.status).toBe(400);
    expect(accepted.body).toEqual({ error: 'invite_unavailable' });
  });

  it('rejects an expired invitation without creating a user', async () => {
    const fixture = await createFixture();
    const email = `expired-register-${crypto.randomUUID()}@example.test`;
    const invite = await createActiveInvite(fixture, email);
    await prisma.$executeRaw`UPDATE "Invite" SET "expiresAt" = now() - interval '1 day' WHERE "id" = ${invite.id}`;

    const response = await registerInvite(fixture, invite.code, email);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'invite_expired' });
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('rejects mismatched and unbound invitation emails without creating users', async () => {
    const fixture = await createFixture();
    const inviteEmail = `bound-register-${crypto.randomUUID()}@example.test`;
    const mismatchEmail = `wrong-register-${crypto.randomUUID()}@example.test`;
    const mismatchedInvite = await createActiveInvite(fixture, inviteEmail);
    const unboundInvite = await createInviteRecord(fixture, null);
    await prisma.$executeRaw`
      UPDATE "Invite" SET "expiresAt" = now() + interval '7 days' WHERE "id" = ${unboundInvite.id}
    `;

    const mismatched = await registerInvite(fixture, mismatchedInvite.code, mismatchEmail);
    const unboundEmail = `unbound-register-${crypto.randomUUID()}@example.test`;
    const unbound = await registerInvite(fixture, unboundInvite.code, unboundEmail);

    expect(mismatched.status).toBe(403);
    expect(mismatched.body).toEqual({ error: 'invite_email_mismatch' });
    expect(unbound.status).toBe(403);
    expect(unbound.body).toEqual({ error: 'invite_email_mismatch' });
    expect(await prisma.user.findUnique({ where: { email: mismatchEmail } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: unboundEmail } })).toBeNull();
  });

  it('creates the user and invite binding without a membership before email proof', async () => {
    const fixture = await createFixture();
    const email = `registered-${crypto.randomUUID()}@example.test`;
    const invite = await createActiveInvite(fixture, email, 'admin');

    const response = await registerInvite(fixture, invite.code, email);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(user.id);
    await waitForEmailVerification(email);
    const membership = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: fixture.tenantId, userId: user.id } },
    });
    const redeemed = await prisma.invite.findUnique({
      where: { id: invite.id },
      select: { usedAt: true, usedById: true },
    });
    await waitForMail(email);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(response.body.delivery).toBe('sent');
    expect(response.body).not.toHaveProperty('token');
    expect(user.emailVerifiedAt).toBeNull();
    expect(membership).toBeNull();
    expect(redeemed).toEqual({ usedAt: null, usedById: null });
  });

  it('rolls back the new user and the invite binding when the binding insert fails', async () => {
    const fixture = await createFixture();
    const email = `registration-rollback-${crypto.randomUUID()}@example.test`;
    const invite = await createActiveInvite(fixture, email);
    await rejectInviteBindingInsert(invite.id);

    const response = await registerInvite(fixture, invite.code, email);
    const redeemed = await prisma.invite.findUnique({
      where: { id: invite.id },
      select: { usedAt: true, usedById: true },
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'registration failed' });
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect(redeemed).toEqual({ usedAt: null, usedById: null });
  });

  it('creates exactly one account for five parallel registrations with one code and address', async () => {
    const fixture = await createFixture();
    const email = `parallel-register-${crypto.randomUUID()}@example.test`;
    const invite = await createActiveInvite(fixture, email);

    const responses = await Promise.all(Array.from({ length: 5 }, () => registerInvite(fixture, invite.code, email)));
    const registeredUser = await prisma.user.findUnique({ where: { email } });
    if (registeredUser) userIds.push(registeredUser.id);
    expect(responses.filter(({ status }) => status === 409)).toHaveLength(5);
    await waitForEmailVerification(email);
    await waitForMail(email);

    expect(registeredUser).not.toBeNull();
    expect(responses.filter((res) => res.body.code === 'EMAIL_VERIFICATION_REQUIRED')).toHaveLength(1);
    expect(responses.filter((res) => res.body.code === 'ACCOUNT_LOGIN_REQUIRED')).toHaveLength(4);
  });
});

describe('POST /auth/register display names', () => {
  it('creates the user with the trimmed name', async () => {
    const fixture = await createFixture();
    const email = `display-name-${crypto.randomUUID()}@example.test`;
    const invite = await createActiveInvite(fixture, email);

    const response = await registerInvite(fixture, invite.code, email, '  Jörg Müller  ');
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(user.id);
    await waitForMail(email);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(response.body.delivery).toBe('sent');
    expect(response.body).not.toHaveProperty('token');
    expect(user.name).toBe('Jörg Müller');
  });

  it('still accepts a registration without a name', async () => {
    const fixture = await createFixture();
    const email = `display-name-missing-${crypto.randomUUID()}@example.test`;
    const invite = await createActiveInvite(fixture, email);

    const response = await request(fixture.app)
      .post('/auth/register')
      .send({ code: invite.code, email, password: 'qacc-registration-password' });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(user.id);
    await waitForMail(email);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(response.body.delivery).toBe('sent');
    expect(response.body).not.toHaveProperty('token');
    expect(user.name).toBeNull();
  });
});

describe('guest invite mail expiry', () => {
  it('states the guest access expiry in Berlin time with its zone', async () => {
    const fixture = await createFixture();
    const email = `guest-${crypto.randomUUID()}@example.test`;
    const expiresAt = new Date(Math.ceil((Date.now() + 3 * 24 * 60 * 60 * 1000) / 3_600_000) * 3_600_000);

    const response = await request(fixture.app)
      .post('/guests')
      .set('x-user', fixture.ownerId)
      .set('x-tenant', fixture.tenantId)
      .send({ email, name: 'Test Guest', expiresAt: expiresAt.toISOString() });
    expect(response.status).toBe(200);

    const guestUser = await prisma.user.findFirst({ where: { email } });
    if (guestUser) userIds.push(guestUser.id);

    const mail = await waitForMail(email);
    expect(mail.text).toContain(formatInviteExpiry(expiresAt, undefined));
  });
});
