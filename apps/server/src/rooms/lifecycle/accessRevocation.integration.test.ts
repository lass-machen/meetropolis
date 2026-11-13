import crypto from 'crypto';
import { LocalPresence } from 'colyseus';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { logger } from '../../logger.js';
import type { Role } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import { hashSessionToken } from '../../api/utils/sessionAuth.js';
import { deleteAccount, removeMemberFromTenant } from '../../services/accountDeletion.js';
import type { WorldRoom } from '../WorldRoom.js';
import { subscribeAccessRevocations } from './accessRevocation.js';
import { createWorldAccess } from './worldAccess.js';

/**
 * Removing a member or deleting an account ends the user's open world
 * connections at once, through the access-revoked event on Colyseus presence
 * (the in-process LocalPresence the server uses without Redis), against a REAL
 * PostgreSQL database. The periodic access sweep is only the safety net and is
 * not involved here.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('accessRevocation.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const presence = new LocalPresence();
const userIds: string[] = [];
let tenantId: string;
let tenantSlug: string;
let previousGameServer: typeof global.gameServer;
let previousActiveWorldRooms: typeof global.activeWorldRooms;

async function createUser(role: Role): Promise<{ id: string; sessionId: string }> {
  const user = await prisma.user.create({ data: { email: `qacc-${crypto.randomUUID()}@example.test` } });
  userIds.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });
  // Every connected client stands on a live session row, as a real join via
  // onAuth would leave it: the revoke handler checks the session row first.
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(crypto.randomUUID()),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
    select: { id: true },
  });
  return { id: user.id, sessionId: session.id };
}

async function connectedRoom(users: Array<{ id: string; sessionId: string }>) {
  const clients = users.map((user, i) => ({
    identity: user.id,
    sessionId: `sess-${i}`,
    leave: vi.fn(),
    error: vi.fn(),
  }));
  const players = new Map(clients.map((c) => [c.sessionId, { identity: c.identity }]));
  // The revocation handler reads each session's verified tenant from the
  // registry: every client here was verified for this tenant at join time.
  const room = { presence, prismaForPresence: prisma, state: { players }, clients } as unknown as WorldRoom;
  room.worldAccess = createWorldAccess(room);
  // Real rooms expose revokeAccess (see WorldRoom); the stand-in wires the
  // same delegation so the local broadcast path reaches its real registry.
  room.revokeAccess = (targetUserId: string): void => {
    room.worldAccess.revoke(targetUserId).catch((e: unknown) => {
      logger.error('[WorldRoom] Failed to revoke world access', e);
    });
  };
  for (const [i, client] of clients.entries()) {
    room.worldAccess.register(client.sessionId, {
      identity: client.identity,
      tenantId,
      tenantSlug,
      authSessionId: users[i]?.sessionId,
      isNpc: false,
      zonePrivacyVersion: 1,
    });
  }
  // The subscription is awaited, as WorldRoom.onCreate awaits it: a room
  // without its revocation channel must not exist.
  const unsubscribe = await subscribeAccessRevocations(room);
  // Real rooms join `global.activeWorldRooms` in onCreate, which is where
  // broadcastAccessRevoked revokes locally first; the stand-in registers
  // itself the same way so the local path reaches it.
  const active = global.activeWorldRooms ?? new Set<WorldRoom>();
  active.add(room);
  global.activeWorldRooms = active;
  const release = (): void => {
    unsubscribe();
    active.delete(room);
  };
  return { clients, unsubscribe: release };
}

/** The revocation handler re-proves access against the database; poll for it. */
async function waitFor(left: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!left()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeAll(async () => {
  previousGameServer = global.gameServer;
  previousActiveWorldRooms = global.activeWorldRooms;
  global.gameServer = { presence };
  tenantSlug = `qacc-${crypto.randomUUID()}`;
  tenantId = (await prisma.tenant.create({ data: { slug: tenantSlug, name: tenantSlug } })).id;
});

afterAll(async () => {
  global.gameServer = previousGameServer;
  global.activeWorldRooms = previousActiveWorldRooms;
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('open world connections end with the access (real database)', () => {
  it('disconnects a member at once when an admin removes them, and nobody else', async () => {
    const stays = await createUser('member');
    const removed = await createUser('member');
    const { clients, unsubscribe } = await connectedRoom([stays, removed]);

    await removeMemberFromTenant(prisma, { userId: removed.id, tenantId });
    const [staysClient, removedClient] = clients;
    await waitFor(() => removedClient.leave.mock.calls.length > 0, 5_000);
    unsubscribe();

    // Member removal signs the user out everywhere, so the bundled session
    // check fires first: `session_revoked`, not `not_member_of_tenant`.
    expect(removedClient.error).toHaveBeenCalledWith(4401, 'session_revoked');
    expect(staysClient.leave).not.toHaveBeenCalled();
  });

  it('disconnects a user at once when they delete their own account', async () => {
    const leaving = await createUser('member');
    const { clients, unsubscribe } = await connectedRoom([leaving]);

    await deleteAccount(prisma, leaving.id);
    await waitFor(() => clients[0].leave.mock.calls.length > 0, 5_000);
    unsubscribe();

    expect(clients[0].leave).toHaveBeenCalled();
  });
});
