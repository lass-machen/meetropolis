/**
 * LiveKit token binding and confirmed participant removal through the real
 * stack: the HTTP token route on a real Colyseus server, a real database and
 * a real SFU. The reconciler started here is the harness hook; until the
 * server reconciles SFU access it does nothing, so the removal cases below
 * still see the participant afterwards.
 *
 * Presence is always the admin participant list. A client disconnect is only
 * cleanup. The session reference is derived in this file from the JWT secret
 * and the session row id; the token route is expected to embed that value.
 *
 * The outage case and the restart case are time-dependent and count as
 * load-suspect under high machine load.
 */

import { createHmac, hkdfSync, randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@colyseus/sdk';
import { ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import { createPrismaClient } from '../../db.js';
import { registerApi } from '../../api.js';
import { tenantMiddleware } from '../../tenancy.js';
import { getJwtSecret } from '../../api/utils/authHelpers.js';
import { removeMemberFromTenant } from '../../services/accountDeletion.js';
import { createLivekitAdminClient } from '../audioZones/livekitAdmin.js';
import { cleanupTenants, seedMember, seedTenant, type SeededMember } from '../../testUtils/worldSeed.js';
import {
  connectParticipant,
  disconnectAll,
  listIdentities,
  mintServiceToken,
  pauseSfu,
  startAvReconcile,
  unpauseSfu,
  waitForIdentityGone,
  waitForIdentityPresent,
  type AvReconciler,
} from '../../testUtils/sfuHarness.js';
import {
  disposeAllRooms,
  startMatchmakeServer,
  stopMatchmakeServer,
  type MatchmakeTestServer,
} from '../../testUtils/matchmakeHarness.js';

const FILE = 'avAccessRevocation.integration.test.ts';
const SESSION_REF_INFO = 'meetropolis/av-session-ref/v1';
const PROBE_ROOM = 'readyz';
const PROBE_IDENTITY = 'probe';
const TRANSCRIBER_IDENTITY = 'svc-transcriber';
const FORGED_METADATA = '{"sessionRef":"forged"}';
const SFU_TIMEOUT_MS = 60_000;
const ROUND_TIMEOUT_MS = 10_000;
const RETRY_WINDOW_MS = 40_000;
const PAUSE_LIMIT_MS = 12_000;
const PAUSE_CASE_TIMEOUT_MS = 120_000;

function requireEnv(name: string, purpose: string): void {
  if (!process.env[name]) throw new Error(`${FILE} needs ${name} ${purpose}`);
}

requireEnv('DATABASE_URL', 'pointing at a migrated test database');
requireEnv('LIVEKIT_URL', 'pointing at the test SFU');
requireEnv('LIVEKIT_API_KEY', 'for the test SFU');
requireEnv('LIVEKIT_API_SECRET', 'for the test SFU');
requireEnv('TEST_SFU_CONTAINER', 'naming the test SFU container');

const tenantSlug = `av-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
process.env.DEFAULT_TENANT_SLUG = tenantSlug;

const prisma = createPrismaClient();
const packUuids: string[] = [];
const extraTenantIds: string[] = [];
const extraUserIds: string[] = [];
let apiReady: Promise<void> = Promise.resolve();
let server: MatchmakeTestServer;
let previousGameServer: typeof global.gameServer;
let reconciler: AvReconciler | undefined;
let tenantId = '';
let fixturePackUuid = '';

function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function worldName(slug: string): string {
  return `${slug}:world`;
}

/** HMAC of the session row id, keyed by HKDF(JWT secret, empty salt, fixed label). */
function sessionRefFor(sessionId: string): string {
  const key = Buffer.from(hkdfSync('sha256', getJwtSecret(), Buffer.alloc(0), SESSION_REF_INFO, 32));
  return `v1.${createHmac('sha256', key).update(sessionId).digest('base64url')}`;
}

function jwtMetadata(token: string): string {
  const part = token.split('.')[1];
  if (!part) return '';
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || !('metadata' in parsed)) return '';
    return typeof parsed.metadata === 'string' ? parsed.metadata : '';
  } catch {
    return '';
  }
}

function sessionRefFromMetadata(metadata: string): string | null {
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (typeof parsed !== 'object' || parsed === null || !('sessionRef' in parsed)) return null;
    return typeof parsed.sessionRef === 'string' ? parsed.sessionRef : null;
  } catch {
    return null;
  }
}

function currentReconciler(): AvReconciler {
  if (!reconciler) throw new Error(`${FILE} expected the reconciler to be started`);
  return reconciler;
}

function configureApi(app: express.Express): void {
  app.use(cookieParser());
  app.use(express.json());
  app.use(tenantMiddleware as unknown as express.RequestHandler);
  apiReady = registerApi(app);
}

async function seedAvatarPack(): Promise<void> {
  const uuid = `avpack-${shortId()}`;
  await prisma.avatarPack.create({
    data: {
      uuid,
      name: uuid,
      description: 'session join fixture',
      author: 'fixture',
      version: '1',
      avatars: [{ key: 'business_man' }],
      tenantId: null,
    },
  });
  packUuids.push(uuid);
  fixturePackUuid = uuid;
}

interface TokenResponse {
  status: number;
  text: string;
}

async function postLivekitToken(member: SeededMember, slug: string = tenantSlug): Promise<TokenResponse> {
  const response = await fetch(`${server.base}/livekit/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': slug,
      Authorization: `Bearer ${member.token}`,
    },
    body: JSON.stringify({
      roomName: 'world',
      name: member.userId,
      zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
      identity: member.userId,
    }),
  });
  return { status: response.status, text: (await response.text()).trim() };
}

async function issuedToken(member: SeededMember, slug: string = tenantSlug): Promise<string> {
  const issued = await postLivekitToken(member, slug);
  if (issued.status !== 200 || issued.text.length === 0) {
    throw new Error(`livekit token request failed with status ${issued.status}`);
  }
  return issued.text;
}

async function expectPresent(roomName: string, identity: string): Promise<void> {
  expect(await waitForIdentityPresent(roomName, identity, ROUND_TIMEOUT_MS)).toBe(true);
}

async function expectRemoved(roomName: string, identity: string, timeoutMs = ROUND_TIMEOUT_MS): Promise<void> {
  expect(await waitForIdentityGone(roomName, identity, timeoutMs)).toBe(true);
}

async function connectIssued(member: SeededMember, slug: string = tenantSlug): Promise<string> {
  const token = await issuedToken(member, slug);
  await connectParticipant(token);
  await expectPresent(worldName(slug), member.userId);
  return token;
}

async function connectMinted(roomName: string, identity: string): Promise<void> {
  await connectParticipant(await mintServiceToken(roomName, identity));
  await expectPresent(roomName, identity);
}

/** Publisher wire identity is the `npc-` prefix plus the stored record identity. */
async function connectRecordedNpc(slug: string): Promise<string> {
  const recordIdentity = `keeper-${shortId()}`;
  const wireIdentity = `npc-${recordIdentity}`;
  await prisma.npc.create({
    data: { tenantId, identity: recordIdentity, name: recordIdentity },
  });
  await connectMinted(worldName(slug), wireIdentity);
  return wireIdentity;
}

/** Keeps the socket referenced so the joined seat still exists when access is revoked. */
async function joinWorld(member: SeededMember): Promise<{ sessionId: string }> {
  const client = new Client(server.base);
  client.auth.token = member.token;
  const room = await client.joinOrCreate('world', {
    tenant: tenantSlug,
    avatarId: `${fixturePackUuid}:business_man`,
    zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
    identity: member.userId,
  });
  return room;
}

/** Fixed 12s freeze. Revocation must not extend it, and the participant must outlive it. */
async function pauseForRevocation(member: SeededMember, duringPause?: () => Promise<void>): Promise<void> {
  await pauseSfu();
  try {
    void removeMemberFromTenant(prisma, { userId: member.userId, tenantId }).catch(() => undefined);
    const window = delay(PAUSE_LIMIT_MS);
    if (duringPause) await Promise.race([duringPause(), window]);
    await window;
  } finally {
    await unpauseSfu();
  }
}

async function dropUser(userId: string): Promise<void> {
  await prisma.presence.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.membership.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

async function deleteTenantRow(id: string): Promise<void> {
  const members = await prisma.membership.findMany({ where: { tenantId: id }, select: { userId: true } });
  for (const member of members) extraUserIds.push(member.userId);
  await prisma.presence.deleteMany({ where: { tenantId: id } });
  await prisma.zone.deleteMany({ where: { tenantId: id } });
  await prisma.room.deleteMany({ where: { tenantId: id } });
  await prisma.npc.deleteMany({ where: { tenantId: id } });
  await prisma.map.deleteMany({ where: { tenantId: id } });
  await prisma.invite.deleteMany({ where: { tenantId: id } });
  await prisma.membership.deleteMany({ where: { tenantId: id } });
  await prisma.tenant.deleteMany({ where: { id } });
}

/**
 * The harness list returns identities only. Metadata is read from the same
 * admin `listParticipants` call through the product client.
 */
async function storedMetadata(roomName: string, identity: string): Promise<string> {
  const admin = createLivekitAdminClient();
  if (!admin) throw new Error(`${FILE} needs a LiveKit admin client to read participant metadata`);
  const participants = await admin.listParticipants(roomName);
  const found = participants.find((participant) => participant.identity === identity);
  return found?.metadata ?? '';
}

beforeAll(async () => {
  tenantId = (await seedTenant(prisma, { slug: tenantSlug })).id;
  await seedAvatarPack();
  await prisma.map.create({ data: { tenantId, name: 'office', meta: {} } });
  server = await startMatchmakeServer({ configureApp: configureApi });
  await apiReady;
  previousGameServer = global.gameServer;
  // Colyseus Server is wider than the narrow global.gameServer stand-in.
  global.gameServer = server.gameServer as unknown as typeof global.gameServer;
});

beforeEach(async () => {
  await disposeAllRooms();
  reconciler = await startAvReconcile(prisma);
});

afterEach(async () => {
  await disconnectAll();
  if (reconciler) await reconciler.stop();
  reconciler = undefined;
  await disposeAllRooms();
});

afterAll(async () => {
  await stopMatchmakeServer(server);
  global.gameServer = previousGameServer;
  const tenantIds = [tenantId, ...extraTenantIds];
  await prisma.presence.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.zone.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.room.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.npc.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.map.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.invite.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.avatarPack.deleteMany({ where: { uuid: { in: packUuids } } });
  await cleanupTenants(prisma, tenantIds);
  if (extraUserIds.length > 0) {
    await prisma.session.deleteMany({ where: { userId: { in: extraUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: extraUserIds } } });
  }
  await prisma.$disconnect();
});

describe('livekit token metadata', () => {
  it('binds the token to the session reference', async () => {
    const member = await seedMember(prisma, tenantId);
    const issued = await postLivekitToken(member);
    const metadata = jwtMetadata(issued.text);
    expect(issued.status).toBe(200);
    expect(metadata.includes(member.sessionId)).toBe(false);
    expect(sessionRefFromMetadata(metadata)).toBe(sessionRefFor(member.sessionId));
  }, 30_000);
});

describe('current members', () => {
  it(
    'keeps a participant with a live session',
    async () => {
      const member = await seedMember(prisma, tenantId);
      await connectIssued(member);
      await currentReconciler().runRound();
      expect(await listIdentities(worldName(tenantSlug))).toContain(member.userId);
    },
    SFU_TIMEOUT_MS,
  );
});

describe('reserved participant identities', () => {
  it('refuses a token for a service identity and an npc identity', async () => {
    const identities = [TRANSCRIBER_IDENTITY, `npc-${shortId()}`];
    const statuses: number[] = [];
    for (const userId of identities) {
      await dropUser(userId);
      const member = await seedMember(prisma, tenantId, { userId });
      statuses.push((await postLivekitToken(member)).status);
    }
    expect(statuses.every((status) => status >= 400 && status < 500)).toBe(true);
  }, 30_000);
});

describe('npc publishers', () => {
  it(
    'keeps an npc participant with a matching record',
    async () => {
      const wireIdentity = await connectRecordedNpc(tenantSlug);
      await currentReconciler().runRound();
      expect(await listIdentities(worldName(tenantSlug))).toContain(wireIdentity);
    },
    SFU_TIMEOUT_MS,
  );
});

describe('reused token after membership removal', () => {
  it(
    'removes the participant on the next round',
    async () => {
      const member = await seedMember(prisma, tenantId);
      const token = await connectIssued(member);
      await removeMemberFromTenant(prisma, { userId: member.userId, tenantId });
      await disconnectAll();
      await connectParticipant(token);
      await expectPresent(worldName(tenantSlug), member.userId);
      await currentReconciler().runRound();
      await expectRemoved(worldName(tenantSlug), member.userId);
    },
    SFU_TIMEOUT_MS,
  );
});

describe('service identities', () => {
  it(
    'keeps the transcriber participant',
    async () => {
      await connectMinted(worldName(tenantSlug), TRANSCRIBER_IDENTITY);
      await currentReconciler().runRound();
      expect(await listIdentities(worldName(tenantSlug))).toContain(TRANSCRIBER_IDENTITY);
    },
    SFU_TIMEOUT_MS,
  );
});

describe('revocation during a media-server outage', () => {
  it(
    'removes the participant within the retry window',
    async () => {
      const member = await seedMember(prisma, tenantId);
      const world = await joinWorld(member);
      await connectIssued(member);
      await pauseForRevocation(member);
      await expectRemoved(worldName(tenantSlug), member.userId, RETRY_WINDOW_MS);
      expect(world.sessionId).toEqual(expect.any(String));
    },
    PAUSE_CASE_TIMEOUT_MS,
  );
});

describe('participant metadata', () => {
  it(
    'rejects a self-serve metadata change',
    async () => {
      const member = await seedMember(prisma, tenantId);
      const token = await issuedToken(member);
      const room = await connectParticipant(token);
      const local = room.localParticipant;
      if (!local) throw new Error('connected room has no local participant');
      await expectPresent(worldName(tenantSlug), member.userId);
      await Promise.race([local.updateMetadata(FORGED_METADATA).catch(() => undefined), delay(10_000)]);
      expect(await storedMetadata(worldName(tenantSlug), member.userId)).not.toBe(FORGED_METADATA);
      expect(await listIdentities(worldName(tenantSlug))).toContain(member.userId);
    },
    SFU_TIMEOUT_MS,
  );
});

describe('revocation across a reconciler restart', () => {
  it(
    'removes the participant on the round after restart',
    async () => {
      const member = await seedMember(prisma, tenantId);
      await connectIssued(member);
      await pauseForRevocation(member, async () => {
        await reconciler?.stop();
        reconciler = undefined;
      });
      reconciler = await startAvReconcile(prisma);
      await reconciler.runRound();
      await expectRemoved(worldName(tenantSlug), member.userId, RETRY_WINDOW_MS);
    },
    PAUSE_CASE_TIMEOUT_MS,
  );
});

describe('rooms outside a tenant call', () => {
  it(
    'leaves the readiness probe room unchanged',
    async () => {
      await connectMinted(PROBE_ROOM, PROBE_IDENTITY);
      await currentReconciler().runRound();
      expect(await listIdentities(PROBE_ROOM)).toContain(PROBE_IDENTITY);
    },
    SFU_TIMEOUT_MS,
  );
});

describe('unknown npc identities', () => {
  it(
    'removes an npc participant with no matching record',
    async () => {
      const identity = `npc-${shortId()}`;
      await connectMinted(worldName(tenantSlug), identity);
      await currentReconciler().runRound();
      await expectRemoved(worldName(tenantSlug), identity);
    },
    SFU_TIMEOUT_MS,
  );
});

describe('unresolvable tenant rooms', () => {
  it(
    'removes user participants after a slug rename and a tenant deletion',
    async () => {
      const renamed = await seedTenant(prisma);
      const deleted = await seedTenant(prisma);
      extraTenantIds.push(renamed.id, deleted.id);
      const renamedMember = await seedMember(prisma, renamed.id);
      const deletedMember = await seedMember(prisma, deleted.id);
      await connectMinted(worldName(renamed.slug), renamedMember.userId);
      await connectMinted(worldName(deleted.slug), deletedMember.userId);
      await prisma.tenant.update({ where: { id: renamed.id }, data: { slug: `${renamed.slug}-renamed` } });
      await deleteTenantRow(deleted.id);
      await currentReconciler().runRound();
      const renamedGone = await waitForIdentityGone(worldName(renamed.slug), renamedMember.userId, ROUND_TIMEOUT_MS);
      const deletedGone = await waitForIdentityGone(worldName(deleted.slug), deletedMember.userId, ROUND_TIMEOUT_MS);
      expect([renamedGone, deletedGone]).toEqual([true, true]);
    },
    SFU_TIMEOUT_MS,
  );
});
