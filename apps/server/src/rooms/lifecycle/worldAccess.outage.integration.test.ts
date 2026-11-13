/**
 * A world session must not outlive its verifiable access.
 *
 * A real Colyseus server with the real `WorldRoom` (see
 * testUtils/matchmakeHarness.ts), a real PostgreSQL database (db.js is NOT
 * mocked) and real @colyseus/sdk clients. `WORLD_ACCESS_SWEEP_MS=1000` and
 * `WORLD_ACCESS_LEASE_MS=4000` drive the post-fix cadence (inert before the
 * fix, whose sweep is a hard-coded 60 s).
 *
 *  1. local revocation despite a failed publish: with presence `publish`
 *     rejecting, `removeMemberFromTenant` still disconnects the client within
 *     2 s. Before the fix the client stays (the publish is only logged and
 *     the next sweep is a minute away).
 *  2. unreachable database: with the database container paused the client is
 *     disconnected within lease + 3 s with code 4503 `access_unverified`.
 *     Before the fix the client stays (no lease timer; the wait window is
 *     12 s).
 *  3. a short hiccup disconnects nobody: pause for 1.5 s, unpause, and the
 *     client is still connected after 6 more s. Green before and after the
 *     fix.
 *  4. a guest ends at its stored expiry: a guest with `expiresAt = now + 3 s`
 *     is disconnected with 4006 `guest_expired` no earlier than `expiresAt`
 *     and no later than `expiresAt + 1 s`. Before the fix the client stays
 *     until the 60 s sweep (wait window 6 s).
 *  5. a deleted session ends the world session even though the membership is
 *     intact: after `revokeSessionsForUser` the client is disconnected within
 *     sweep + 3 s with 4401 `session_revoked`. Before the fix the lease keeps
 *     renewing and the client stays (wait window 8 s).
 *
 * The database container is paused via `docker pause` on `TEST_PG_CONTAINER`.
 * A missing or empty value fails at load; `unpause` always runs in a
 * `finally`. Without docker access the file fails fast with a clear error.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import type { Role } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import { getJwtSecret } from '../../api/utils/authHelpers.js';
import { hashSessionToken, revokeSessionsForUser } from '../../api/utils/sessionAuth.js';
import { removeMemberFromTenant } from '../../services/accountDeletion.js';
import {
  disposeAllRooms,
  startMatchmakeServer,
  stopMatchmakeServer,
  type MatchmakeTestServer,
} from '../../testUtils/matchmakeHarness.js';

if (!process.env.DATABASE_URL) {
  throw new Error('worldAccess.outage.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const execFileAsync = promisify(execFile);

function requireTestPgContainer(): string {
  const value = process.env.TEST_PG_CONTAINER;
  if (!value) {
    throw new Error(
      'worldAccess.outage.integration.test.ts needs TEST_PG_CONTAINER naming the test database container',
    );
  }
  return value;
}

const PG_CONTAINER = requireTestPgContainer();
const FILE = 'worldAccess.outage.integration.test.ts';

async function dockerPause(): Promise<void> {
  try {
    await execFileAsync('docker', ['pause', PG_CONTAINER]);
  } catch (e: unknown) {
    throw new Error(
      `${FILE} needs docker access to pause ${PG_CONTAINER}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function dockerUnpause(): Promise<void> {
  try {
    await execFileAsync('docker', ['unpause', PG_CONTAINER]);
  } catch (e: unknown) {
    throw new Error(
      `${FILE} needs docker access to unpause ${PG_CONTAINER}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
const packUuids: string[] = [];
let server: MatchmakeTestServer;
let previousGameServer: typeof global.gameServer;
let tenantId: string;
let tenantSlug: string;
let fixturePackUuid = '';

/**
 * One global (tenantId null) avatar pack so a join that passes onAuth can run
 * to completion. Real fixture row, not a mock: without any pack in scope even
 * a fully authorized join is refused later in onJoin with 526.
 */
async function seedGlobalAvatarPack(): Promise<void> {
  const uuid = `s1r6-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await prisma.avatarPack.create({
    data: {
      uuid,
      name: uuid,
      description: 'outage join fixture',
      author: 's1r6-fixture',
      version: '1',
      avatars: [{ key: 'business_man' }],
      tenantId: null,
    },
  });
  packUuids.push(uuid);
  fixturePackUuid = uuid;
}

async function createTenant(slug: string): Promise<string> {
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

async function createUser(
  memberships: Array<{ tenantId: string; role: Role; expiresAt?: Date }>,
  sessionTenantId: string,
): Promise<{ id: string; token: string }> {
  const user = await prisma.user.create({
    data: {
      email: `s1r6-${crypto.randomUUID()}@example.test`,
      avatarId: `${fixturePackUuid}:business_man`,
    },
  });
  userIds.push(user.id);
  for (const m of memberships) await prisma.membership.create({ data: { userId: user.id, ...m } });
  const token = jwt.sign({ sub: user.id, tid: sessionTenantId, jti: crypto.randomUUID() }, getJwtSecret(), {
    expiresIn: '1h',
  });
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { id: user.id, token };
}

interface TrackedJoin {
  room?: Room;
  error?: unknown;
  left: boolean;
  leftAt: number | null;
  errorMessages: unknown[];
}

function joinOptions(tenant?: string): Record<string, unknown> {
  return {
    ...(tenant ? { tenant } : {}),
    // A real client always names its avatar; without one even an authorized
    // join stops later in onJoin (526), which would blur this gate's signal.
    avatarId: `${fixturePackUuid}:business_man`,
    zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
  };
}

async function joinWorld(identity: string, token: string, tenant?: string): Promise<TrackedJoin> {
  const client = new Client(server.base);
  client.auth.token = token;
  const tracked: TrackedJoin = { left: false, leftAt: null, errorMessages: [] };
  try {
    const room = await client.joinOrCreate('world', joinOptions(tenant));
    tracked.room = room;
    room.onLeave(() => {
      tracked.left = true;
      tracked.leftAt = Date.now();
    });
    room.onError((code, message) => {
      tracked.errorMessages.push({ code, message });
    });
  } catch (error) {
    tracked.error = error;
  }
  return tracked;
}

/** Real waiting with polling on the condition, never a fixed sleep as proof. */
async function waitFor(left: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!left()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Cleanup-only leave: never fail the test, never hang on an already swept room. */
async function leaveQuietly(join: TrackedJoin): Promise<void> {
  if (join.left || !join.room) return;
  await Promise.race([join.room.leave().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 3_000))]);
}

beforeAll(async () => {
  // Fail fast with a clear error when docker (or the container) is missing:
  // cases 2 and 3 pause the database through it.
  try {
    await execFileAsync('docker', ['inspect', PG_CONTAINER]);
  } catch (e: unknown) {
    throw new Error(`${FILE} needs docker access to ${PG_CONTAINER}: ${e instanceof Error ? e.message : String(e)}`);
  }
  vi.stubEnv('WORLD_ACCESS_SWEEP_MS', '1000');
  vi.stubEnv('WORLD_ACCESS_LEASE_MS', '4000');
  tenantSlug = `s1r6-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  tenantId = await createTenant(tenantSlug);
  await seedGlobalAvatarPack();
  server = await startMatchmakeServer();
  // Revocation events flow through the server presence, as in production
  // (index.ts exposes the Colyseus server globally for broadcasters).
  previousGameServer = global.gameServer;
  global.gameServer = server.gameServer;
});

beforeEach(async () => {
  await disposeAllRooms();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await stopMatchmakeServer(server);
  global.gameServer = previousGameServer;
  await prisma.avatarPack.deleteMany({ where: { uuid: { in: packUuids } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

describe('world access survives publish and database faults (real database)', () => {
  it('case 1: revocation reaches the room even when the publish fails', async () => {
    const joined = await joinWorld(
      's1r6-case1',
      (await createUser([{ tenantId, role: 'member' }], tenantId)).token,
      tenantSlug,
    );
    expect(joined.error, 'Fall 1: Beitritt muss gelingen').toBeUndefined();
    const presence = server.gameServer.presence;
    if (!presence) throw new Error(`${FILE} Fall 1: matchmake server has no presence`);
    const publishSpy = vi.spyOn(presence, 'publish').mockRejectedValue(new Error('s1r6 presence down'));
    try {
      const userId = userIds[userIds.length - 1];
      await removeMemberFromTenant(prisma, { userId, tenantId });
      await waitFor(() => joined.left, 2_000);
    } finally {
      publishSpy.mockRestore();
    }
    expect(joined.left, 'Fall 1: Client muss trotz Publish-Fehler getrennt sein').toBe(true);

    await leaveQuietly(joined);
  }, 30_000);

  it('case 2: an unreachable database ends the session with 4503 access_unverified', async () => {
    const joined = await joinWorld(
      's1r6-case2',
      (await createUser([{ tenantId, role: 'member' }], tenantId)).token,
      tenantSlug,
    );
    expect(joined.error, 'Fall 2: Beitritt muss gelingen').toBeUndefined();
    try {
      await dockerPause();
      // Lease (4 s) + 3 s headroom; before the fix nothing fires here.
      await waitFor(() => joined.left, 12_000);
    } finally {
      await dockerUnpause();
    }
    expect(joined.left, 'Fall 2: Client muss bei unerreichbarer DB getrennt sein').toBe(true);
    expect(
      joined.errorMessages,
      `Fall 2: 4503 access_unverified erwartet, erhalten=${JSON.stringify(joined.errorMessages)}`,
    ).toContainEqual({ code: 4503, message: 'access_unverified' });

    await leaveQuietly(joined);
  }, 60_000);

  it('case 3: a short database hiccup disconnects nobody', async () => {
    const joined = await joinWorld(
      's1r6-case3',
      (await createUser([{ tenantId, role: 'member' }], tenantId)).token,
      tenantSlug,
    );
    expect(joined.error, 'Fall 3: Beitritt muss gelingen').toBeUndefined();
    try {
      await dockerPause();
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    } finally {
      await dockerUnpause();
    }
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    expect(joined.left, 'Fall 3: Client muss nach kurzem Schluckauf verbunden bleiben').toBe(false);

    await leaveQuietly(joined);
  }, 60_000);

  it('case 4: a guest ends at its stored expiry with 4006 guest_expired', async () => {
    const expiresAtMs = Date.now() + 3_000;
    const joined = await joinWorld(
      's1r6-case4',
      (await createUser([{ tenantId, role: 'guest', expiresAt: new Date(expiresAtMs) }], tenantId)).token,
      tenantSlug,
    );
    expect(joined.error, 'Fall 4: Gast-Beitritt muss gelingen').toBeUndefined();
    await waitFor(() => joined.left, Math.max(expiresAtMs - Date.now() + 1_000, 2_000));
    expect(joined.left, 'Fall 4: Gast muss zum Ablauf getrennt sein').toBe(true);
    expect(
      joined.errorMessages,
      `Fall 4: 4006 guest_expired erwartet, erhalten=${JSON.stringify(joined.errorMessages)}`,
    ).toContainEqual({ code: 4006, message: 'guest_expired' });
    expect(
      joined.leftAt,
      `Fall 4: Trennung nicht vor expiresAt, leftAt=${String(joined.leftAt)} expiresAt=${String(expiresAtMs)}`,
    ).toBeGreaterThanOrEqual(expiresAtMs - 750);

    await leaveQuietly(joined);
  }, 30_000);

  it('case 5: a deleted session ends the world session with 4401 session_revoked', async () => {
    const user = await createUser([{ tenantId, role: 'member' }], tenantId);
    const joined = await joinWorld('s1r6-case5', user.token, tenantSlug);
    expect(joined.error, 'Fall 5: Beitritt muss gelingen').toBeUndefined();
    const userId = userIds[userIds.length - 1];
    // Only the session row goes: the membership stays, so the session check —
    // not a missing membership — has to end the world session.
    await revokeSessionsForUser(prisma, userId);
    expect(
      await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } }),
      'Fall 5: Mitgliedschaft muss bestehen bleiben',
    ).not.toBeNull();
    // Next sweep (1 s) + headroom; before the fix the lease keeps renewing.
    await waitFor(() => joined.left, 8_000);
    expect(joined.left, 'Fall 5: Client muss nach Sitzungsende getrennt sein').toBe(true);
    expect(
      joined.errorMessages,
      `Fall 5: 4401 session_revoked erwartet, erhalten=${JSON.stringify(joined.errorMessages)}`,
    ).toContainEqual({ code: 4401, message: 'session_revoked' });

    await leaveQuietly(joined);
  }, 30_000);
});
