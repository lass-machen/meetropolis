import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from 'colyseus';
import { ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import type { Role } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import { getJwtSecret } from '../../api/utils/authHelpers.js';
import { hashSessionToken } from '../../api/utils/sessionAuth.js';
import type { WorldRoom } from '../WorldRoom.js';
import { authenticateWorldJoin } from './onAuth.js';
import { startGuestExpiryInterval } from './guestExpiry.js';
import { createWorldAccess } from './worldAccess.js';

/**
 * World access requires a tenant membership, at join time and while connected,
 * checked against a REAL PostgreSQL database.
 *
 * A session stays valid after its owner lost the membership of the tenant in
 * its `tid` claim (removed member, expired guest). The world join must refuse
 * such a session, and a client that is already connected must be disconnected
 * by the room's periodic access sweep.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('worldAccess.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
let tenantId: string;
let tenantSlug: string;

async function createTenant(slug = `case-${crypto.randomUUID()}`): Promise<string> {
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

async function createUser(
  memberships: Array<{ tenantId: string; role: Role; expiresAt?: Date }>,
): Promise<{ id: string; token: string; sessionId: string }> {
  const user = await prisma.user.create({ data: { email: `case-${crypto.randomUUID()}@example.test` } });
  userIds.push(user.id);
  for (const m of memberships) await prisma.membership.create({ data: { userId: user.id, ...m } });
  // The session is scoped to the world's tenant, whatever the memberships say.
  const token = jwt.sign({ sub: user.id, tid: tenantId, jti: crypto.randomUUID() }, getJwtSecret(), {
    expiresIn: '1h',
  });
  const session = await prisma.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
    select: { id: true },
  });
  return { id: user.id, token, sessionId: session.id };
}

function join(token: string) {
  const context = { token, headers: new Headers(), ip: '127.0.0.1' } as AuthContext;
  return authenticateWorldJoin(
    { tenant: tenantSlug, zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION },
    context,
    prisma,
  );
}

function makeRoom(
  players: Map<string, { identity: string }>,
  clients: unknown[],
  sessionIds: Map<string, string>,
): WorldRoom {
  const room = {
    metadata: { tenant: tenantSlug },
    prismaForPresence: prisma,
    state: { players },
    clients,
  } as unknown as WorldRoom;
  // The sweep reads each session's verified tenant from the registry, never
  // the room slug: every player here was verified for this tenant at join time.
  // The bundled session check needs each entry's database session row, as a
  // real join via onAuth would store it.
  room.worldAccess = createWorldAccess(room);
  for (const [sessionId, player] of players) {
    room.worldAccess.register(sessionId, {
      identity: player.identity,
      tenantId,
      tenantSlug,
      sessionId: sessionIds.get(sessionId) ?? null,
      authSessionId: sessionIds.get(sessionId),
      isNpc: false,
      zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
    });
  }
  return room;
}

/** Fire the room's 60 s sweep once (timer functions only, the clock stays real). */
async function runOneSweep(room: WorldRoom): Promise<void> {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    const interval = startGuestExpiryInterval(room);
    await vi.advanceTimersByTimeAsync(60_000);
    clearInterval(interval);
  } finally {
    vi.useRealTimers();
  }
}

beforeAll(async () => {
  tenantSlug = `case-${crypto.randomUUID()}`;
  tenantId = await createTenant(tenantSlug);
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

describe('world join requires a membership (real database)', () => {
  it('admits a member', async () => {
    const member = await createUser([{ tenantId, role: 'member' }]);
    await expect(join(member.token)).resolves.toMatchObject({ identity: member.id });
  });

  it('refuses a signed-in user without a membership in the session tenant', async () => {
    const removed = await createUser([]);
    await expect(join(removed.token)).rejects.toThrow('not_member_of_tenant');
  });

  it('refuses an expired guest', async () => {
    const guest = await createUser([{ tenantId, role: 'guest', expiresAt: new Date(Date.now() - 60_000) }]);
    await expect(join(guest.token)).rejects.toThrow('not_member_of_tenant');
  });

  it('admits an operator (owner of the internal tenant)', async () => {
    const existing = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
    const internalId = existing?.id ?? (await createTenant('internal'));
    const operator = await createUser([{ tenantId: internalId, role: 'owner' }]);
    await expect(join(operator.token)).resolves.toMatchObject({ identity: operator.id });
  });
});

describe('connected clients lose the world with their membership (real database)', () => {
  it('disconnects a connected user whose membership is gone and keeps the members', async () => {
    const member = await createUser([{ tenantId, role: 'member' }]);
    const removed = await createUser([{ tenantId, role: 'member' }]);
    await prisma.membership.deleteMany({ where: { userId: removed.id } });

    const memberClient = { sessionId: 'sess-member', leave: vi.fn(), error: vi.fn() };
    const removedClient = { sessionId: 'sess-removed', leave: vi.fn(), error: vi.fn() };
    const players = new Map([
      ['sess-member', { identity: member.id }],
      ['sess-removed', { identity: removed.id }],
    ]);
    // The membership is removed directly, without touching the session rows:
    // the session check passes and the membership proof still disconnects
    // with `not_member_of_tenant`.
    const sessionIds = new Map([
      ['sess-member', member.sessionId],
      ['sess-removed', removed.sessionId],
    ]);
    await runOneSweep(makeRoom(players, [memberClient, removedClient], sessionIds));

    await vi.waitFor(() => expect(removedClient.error).toHaveBeenCalledWith(4401, 'not_member_of_tenant'), {
      timeout: 5_000,
    });
    expect(removedClient.leave).toHaveBeenCalled();
    expect(memberClient.leave).not.toHaveBeenCalled();
  });
});
