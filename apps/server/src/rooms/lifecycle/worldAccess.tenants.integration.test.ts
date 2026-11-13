/**
 * Revocation and the room access sweep must use the verified client
 * tenant, not the room slug.
 *
 * A real Colyseus server with the real `WorldRoom` (see
 * testUtils/matchmakeHarness.ts), a real PostgreSQL database (db.js is NOT
 * mocked) and real @colyseus/sdk clients. ZONE_PRIVACY_TENANT_ENFORCE stays
 * unset, so the legacy mixed-room join is admitted at join time.
 *
 * Before the R3 fix the sweep reads only `room.metadata.tenant` and every
 * room listens only on its own `access_revoked:<slug>` channel:
 *  1. an allowed mixed-room client (member of A in M's room) is swept as
 *     `not_member_of_tenant`, although its verified tenant A still grants
 *     access;
 *  2. with a missing metadata tenant the sweep skips the room entirely, so a
 *     client whose membership is gone stays connected;
 *  3. a revocation in A never reaches the client's session in M's room;
 *  4. deleting an operator account (no membership in A) never reaches A's room;
 *  5. control: a second member of A in the same room is unaffected by 3.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import type { Role } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import { getJwtSecret } from '../../api/utils/authHelpers.js';
import { hashSessionToken } from '../../api/utils/sessionAuth.js';
import { deleteAccount, removeMemberFromTenant } from '../../services/accountDeletion.js';
import {
  disposeAllRooms,
  startMatchmakeServer,
  stopMatchmakeServer,
  type MatchmakeTestServer,
} from '../../testUtils/matchmakeHarness.js';

if (!process.env.DATABASE_URL) {
  throw new Error('worldAccess.tenants.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
const packUuids: string[] = [];
let server: MatchmakeTestServer;
let previousGameServer: typeof global.gameServer;
let tenantAId: string;
let tenantASlug: string;
let tenantMSlug: string;
let fixturePackUuid = '';

/**
 * One global (tenantId null) avatar pack so a join that passes onAuth can run
 * to completion. Real fixture row, not a mock: without any pack in scope even
 * a fully authorized join is refused later in onJoin with 526.
 */
async function seedGlobalAvatarPack(): Promise<void> {
  const uuid = `s1r3-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await prisma.avatarPack.create({
    data: {
      uuid,
      name: uuid,
      description: 'tenant join fixture',
      author: 's1r3-fixture',
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
      email: `s1r3-${crypto.randomUUID()}@example.test`,
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
  const tracked: TrackedJoin = { left: false, errorMessages: [] };
  try {
    const room = await client.joinOrCreate('world', joinOptions(tenant));
    tracked.room = room;
    room.onLeave(() => {
      tracked.left = true;
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
  tenantASlug = `s1r3-a-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  tenantMSlug = `s1r3-m-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  tenantAId = await createTenant(tenantASlug);
  await createTenant(tenantMSlug);
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
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await stopMatchmakeServer(server);
  global.gameServer = previousGameServer;
  await prisma.avatarPack.deleteMany({ where: { uuid: { in: packUuids } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

describe('verified client tenant wins over the room slug (real database)', () => {
  it('keeps an allowed mixed-room client and sweeps one whose tenant is gone', async () => {
    // Fall 2 first, on the empty server: without options.tenant the join
    // creates a room whose metadata is DEFAULT_TENANT_SLUG.
    const missingSlug = `s1r3-gone-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    vi.stubEnv('DEFAULT_TENANT_SLUG', missingSlug);
    const gone = await createUser([{ tenantId: tenantAId, role: 'member' }], tenantAId);
    const goneJoin = await joinWorld(gone.id, gone.token);
    expect(goneJoin.error, 'Fall 2: Beitritt ohne Tenant muss gelingen').toBeUndefined();
    // Direct membership removal, without any revocation event.
    await prisma.membership.deleteMany({ where: { userId: gone.id } });

    // Fall 1: member of A in the room of M (M exists, the join is allowed
    // while ZONE_PRIVACY_TENANT_ENFORCE is unset).
    const mixed = await createUser([{ tenantId: tenantAId, role: 'member' }], tenantAId);
    const mixedJoin = await joinWorld(mixed.id, mixed.token, tenantMSlug);
    expect(mixedJoin.error, 'Fall 1: Mischraum-Beitritt muss gelingen').toBeUndefined();

    // One shared wait for both cases: at least one full pre-fix 60 s sweep.
    await new Promise((resolve) => setTimeout(resolve, 65_000));

    console.log(
      `[s1r3-rot] nach 65 s: Fall 1 (Mischraum) verbunden=${String(!mixedJoin.left)} ` +
        `Fehler=${JSON.stringify(mixedJoin.errorMessages)} | Fall 2 (Metadaten-Tenant fehlt) ` +
        `verbunden=${String(!goneJoin.left)} Fehler=${JSON.stringify(goneJoin.errorMessages)}`,
    );
    expect(
      mixedJoin.left,
      `Fall 1: Mischraum-Client muss verbunden bleiben, Fehler=${JSON.stringify(mixedJoin.errorMessages)}`,
    ).toBe(false);
    await waitFor(() => goneJoin.left, 5_000);
    expect(goneJoin.left, 'Fall 2: Client ohne Metadaten-Tenant muss getrennt sein').toBe(true);

    await leaveQuietly(mixedJoin);
    await leaveQuietly(goneJoin);
  }, 120_000);

  it('ends the mixed-room session on revocation in its own tenant, nobody else', async () => {
    const staying = await createUser([{ tenantId: tenantAId, role: 'member' }], tenantAId);
    const revoked = await createUser([{ tenantId: tenantAId, role: 'member' }], tenantAId);
    const stayingJoin = await joinWorld(staying.id, staying.token, tenantMSlug);
    const revokedJoin = await joinWorld(revoked.id, revoked.token, tenantMSlug);
    expect(stayingJoin.error).toBeUndefined();
    expect(revokedJoin.error).toBeUndefined();
    expect(stayingJoin.room?.roomId).toBe(revokedJoin.room?.roomId);

    await removeMemberFromTenant(prisma, { userId: revoked.id, tenantId: tenantAId });

    // Fall 3: the revocation in A must end the session in M's room at once.
    await waitFor(() => revokedJoin.left, 3_000);
    expect(revokedJoin.left, 'Fall 3: entzogener Client muss getrennt sein').toBe(true);
    // Fall 5 (Gegenprobe): the other member of A in the same room stays.
    expect(stayingJoin.left, 'Fall 5: zweites Mitglied von A bleibt verbunden').toBe(false);

    await leaveQuietly(stayingJoin);
    await leaveQuietly(revokedJoin);
  }, 30_000);

  it('ends the world session of a deleted operator account', async () => {
    const existing = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
    const internalId = existing?.id ?? (await createTenant('internal'));
    const createdInternal = !existing;
    try {
      const operator = await createUser([{ tenantId: internalId, role: 'owner' }], tenantAId);
      const operatorJoin = await joinWorld(operator.id, operator.token, tenantASlug);
      expect(operatorJoin.error, 'Fall 4: Betreiber-Beitritt muss gelingen').toBeUndefined();

      // Fall 4: account deletion publishes no slug of A, yet A's room must end
      // the operator session at once.
      await deleteAccount(prisma, operator.id);
      await waitFor(() => operatorJoin.left, 3_000);
      expect(operatorJoin.left, 'Fall 4: Betreiber muss nach Kontoloeschung getrennt sein').toBe(true);

      await leaveQuietly(operatorJoin);
    } finally {
      if (createdInternal) await prisma.tenant.deleteMany({ where: { id: internalId } });
    }
  }, 30_000);
});
