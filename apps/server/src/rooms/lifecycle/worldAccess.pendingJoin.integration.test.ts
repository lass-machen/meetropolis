/**
 * A revocation between onAuth and player registration must kill the
 * pending join.
 *
 * A real Colyseus server with the real `WorldRoom` (see
 * testUtils/matchmakeHarness.ts), a real PostgreSQL database and real
 * @colyseus/sdk clients. `db.js` is mocked ONLY to wrap the REAL PrismaClient
 * with a gate: `membership.findFirst` with `where.role === 'guest'` for the
 * target userId (that is `checkGuestExpired` in onJoin.completion.ts — after
 * onAuth, before `players.set`) waits until the test removes the membership
 * and releases it, then passes through to the real query. Every other call
 * goes straight to the real database.
 *
 * Flow: the user is a member of A and B; `joinOrCreate` for A starts (not
 * awaited) -> wait until the gate is reached -> `removeMemberFromTenant` (a
 * real commit with a real revocation event) -> release the gate.
 *
 * After the fix the join is rejected with 4401, the room holds no player
 * of that identity, and the client never receives `presence_recent` or
 * `full_state`. Before the fix the join succeeds.
 *
 * Rejection form (observed on the green run): `joinOrCreate` REJECTS with
 * code 4401 (`MatchMakeError`) — the server's `client.error(4401)` during the
 * join handshake surfaces as a refused matchmake, so there is no room to
 * leave and no `onError`/`onLeave` sequence. The test therefore accepts a
 * rejected `joinOrCreate` OR an error-plus-leave on a resolved room, and
 * asserts the shared invariants (4401, no player, no confidential messages)
 * in both cases.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import type { PrismaClient } from '../../generated/prisma/index.js';
import type { Role } from '../../generated/prisma/index.js';
import { getJwtSecret } from '../../api/utils/authHelpers.js';
import { hashSessionToken } from '../../api/utils/sessionAuth.js';
import { removeMemberFromTenant } from '../../services/accountDeletion.js';
import {
  disposeAllRooms,
  startMatchmakeServer,
  stopMatchmakeServer,
  type MatchmakeTestServer,
} from '../../testUtils/matchmakeHarness.js';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'worldAccess.pendingJoin.integration.test.ts needs DATABASE_URL pointing at a migrated test database',
  );
}

/** Gate state: hoisted so the `vi.mock` factory below can close over it. */
const gate = vi.hoisted(() => {
  let releaseGate!: () => void;
  const gatePromise = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  return {
    targetUserId: null as string | null,
    hit: false,
    passed: false,
    gatePromise,
    release: (): void => releaseGate(),
  };
});

type MembershipFindFirst = PrismaClient['membership']['findFirst'];

vi.mock('../../db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db.js')>();
  const real = actual.createPrismaClient();
  const gatedMembership = Object.create(real.membership) as PrismaClient['membership'];
  const realFindFirst = real.membership.findFirst.bind(real.membership);
  gatedMembership.findFirst = (async (args: unknown) => {
    const where = (args as { where?: { role?: unknown; userId?: unknown } } | undefined)?.where;
    if (gate.targetUserId !== null && !gate.passed && where?.role === 'guest' && where?.userId === gate.targetUserId) {
      gate.hit = true;
      gate.passed = true;
      await gate.gatePromise;
    }
    return realFindFirst(args as never);
  }) as MembershipFindFirst;
  const wrapped = new Proxy(real, {
    get(target, prop): unknown {
      if (prop === 'membership') return gatedMembership;
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? (value as (...a: never[]) => unknown).bind(target) : value;
    },
  });
  return { createPrismaClient: () => wrapped };
});

import { createPrismaClient } from '../../db.js';

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
const packUuids: string[] = [];
let server: MatchmakeTestServer;
let previousGameServer: typeof global.gameServer;
let tenantAId: string;
let tenantASlug: string;
let tenantBId: string;
let fixturePackUuid = '';

/**
 * One global (tenantId null) avatar pack so a join that passes onAuth can run
 * to completion. Real fixture row, not a mock: without any pack in scope even
 * a fully authorized join is refused later in onJoin with 526.
 */
async function seedGlobalAvatarPack(): Promise<void> {
  const uuid = `pjoin-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await prisma.avatarPack.create({
    data: {
      uuid,
      name: uuid,
      description: 'pending join fixture',
      author: 'pjoin-fixture',
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
  memberships: Array<{ tenantId: string; role: Role }>,
  sessionTenantId: string,
): Promise<{ id: string; token: string }> {
  const user = await prisma.user.create({
    data: {
      email: `pjoin-${crypto.randomUUID()}@example.test`,
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

function joinOptions(tenant?: string): Record<string, unknown> {
  return {
    ...(tenant ? { tenant } : {}),
    // A real client always names its avatar; without one even an authorized
    // join stops later in onJoin (526), which would blur this gate's signal.
    avatarId: `${fixturePackUuid}:business_man`,
    zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
  };
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
async function leaveQuietly(room: Room | undefined, left: () => boolean): Promise<void> {
  if (left() || !room) return;
  await Promise.race([room.leave().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 3_000))]);
}

beforeAll(async () => {
  tenantASlug = `pjoin-a-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const tenantBSlug = `pjoin-b-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  tenantAId = await createTenant(tenantASlug);
  tenantBId = await createTenant(tenantBSlug);
  await seedGlobalAvatarPack();
  server = await startMatchmakeServer();
  // Revocation events flow through the server presence, as in production
  // (index.ts exposes the Colyseus server globally for broadcasters).
  previousGameServer = global.gameServer;
  // Colyseus Server is wider than the narrow global.gameServer stand-in.
  global.gameServer = server.gameServer as unknown as typeof global.gameServer;
});

beforeEach(async () => {
  await disposeAllRooms();
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

describe('revocation between onAuth and player registration ends the pending join', () => {
  it('rejects with 4401, publishes no player and sends no confidential state', async () => {
    // An observer member of A stays in A's room for the whole test, so the
    // room (and its player set) outlives the rejected join: its synced state
    // is the witness that no player of the revoked identity was published.
    const observer = await createUser([{ tenantId: tenantAId, role: 'member' }], tenantAId);
    const observerClient = new Client(server.base);
    observerClient.auth.token = observer.token;
    const observerRoom = await observerClient.joinOrCreate('world', joinOptions(tenantASlug));
    const observedJoins: unknown[] = [];
    observerRoom.onMessage('player_joined', (msg: unknown) => observedJoins.push(msg));
    const observerRoomId = observerRoom.roomId;

    // The revoked user is a member of A and B; its session belongs to A.
    const revoked = await createUser(
      [
        { tenantId: tenantAId, role: 'member' },
        { tenantId: tenantBId, role: 'member' },
      ],
      tenantAId,
    );
    gate.targetUserId = revoked.id;

    const revokedClient = new Client(server.base);
    revokedClient.auth.token = revoked.token;
    // Started, not awaited: onAuth passes while the membership still exists,
    // then the join parks at the guest-expiry gate before `players.set`.
    const joinPromise = revokedClient.joinOrCreate('world', joinOptions(tenantASlug));

    // The gate proves onAuth already admitted this identity for A.
    await waitFor(() => gate.hit, 15_000);

    // Real commit with a real revocation event, strictly between onAuth and
    // the player registration.
    await removeMemberFromTenant(prisma, { userId: revoked.id, tenantId: tenantAId });
    gate.release();

    let joinError: unknown;
    let revokedRoom: Room | undefined;
    try {
      revokedRoom = await joinPromise;
    } catch (error) {
      joinError = error;
    }

    const seen = { presenceRecent: false, fullState: false, errors: [] as unknown[], left: false };
    if (revokedRoom) {
      expect(revokedRoom.roomId, 'pending join lands in the observed room').toBe(observerRoomId);
      revokedRoom.onMessage('presence_recent', () => {
        seen.presenceRecent = true;
      });
      revokedRoom.onMessage('full_state', () => {
        seen.fullState = true;
      });
      revokedRoom.onError((code, message) => {
        seen.errors.push({ code, message });
      });
      revokedRoom.onLeave(() => {
        seen.left = true;
      });
      // A resolved join that is then rejected still has to leave promptly.
      // Pre-fix the join simply succeeds and stays, so the absence of any
      // error is not waited on: the 4401 assertion below fails instead.
      if (!joinError) {
        await waitFor(() => seen.errors.length > 0, 5_000).catch(() => {});
        if (seen.errors.length > 0) await waitFor(() => seen.left, 5_000);
      }
    }

    console.log(
      `[pending-join] join rejected=${JSON.stringify(joinError ?? seen.errors)} left=${String(seen.left)} ` +
        `presence_recent=${String(seen.presenceRecent)} full_state=${String(seen.fullState)}`,
    );

    // Rejected with 4401 in one of the two documented forms.
    const rejectedUpfront = joinError !== undefined && (joinError as { code?: unknown }).code === 4401;
    const rejectedAfterJoin =
      joinError === undefined && seen.errors.some((e) => (e as { code?: unknown }).code === 4401) && seen.left;
    expect(
      rejectedUpfront || rejectedAfterJoin,
      `pending join must be rejected with 4401 (upfront=${String(joinError)} after=${JSON.stringify(seen.errors)})`,
    ).toBe(true);

    // Settling window for the delayed confidential sends (they fire 200 ms
    // after completion when scheduled): nothing may arrive late.
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(seen.presenceRecent, 'rejected join must not receive presence_recent').toBe(false);
    expect(seen.fullState, 'rejected join must not receive full_state').toBe(false);

    // The room holds no player of the revoked identity: nothing was announced
    // to the observer, and its synced state carries no such player.
    expect(
      observedJoins.filter((m) => (m as { identity?: unknown }).identity === revoked.id),
      'no player_joined for the revoked identity',
    ).toHaveLength(0);
    const observerIdentities: unknown[] = [];
    for (const player of observerRoom.state.players.values()) {
      observerIdentities.push((player as { identity?: unknown }).identity);
    }
    expect(observerIdentities, 'room state holds no player of the revoked identity').not.toContain(revoked.id);

    await leaveQuietly(revokedRoom, () => seen.left);
    await leaveQuietly(observerRoom, () => false);
  }, 60_000);
});
