/**
 * Human world joins always require a live session row.
 *
 * A real Colyseus server with the real WorldRoom (see
 * testUtils/matchmakeHarness.ts), a real PostgreSQL database (db.js is NOT
 * mocked) and a real @colyseus/sdk client. Every case runs with
 * ZONE_PRIVACY_AUTH_ENFORCE unset and with it set to 'true'.
 *
 * Before the R4 fix the token-less, revoked-session and deleted-account joins
 * are admitted while enforcement is off (the legacy fallback); after the fix
 * every one of them is rejected with 4401 'unauthorized'.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import type { Role } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import { getJwtSecret } from '../../api/utils/authHelpers.js';
import { hashSessionToken, revokeSessionsForUser } from '../../api/utils/sessionAuth.js';
import { deleteAccount } from '../../services/accountDeletion.js';
import { AUTH_REJECTED_CODE } from './onAuth.js';
import {
  disposeAllRooms,
  startMatchmakeServer,
  stopMatchmakeServer,
  type MatchmakeTestServer,
} from '../../testUtils/matchmakeHarness.js';

if (!process.env.DATABASE_URL) {
  throw new Error('onAuth.session.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
const packUuids: string[] = [];
let server: MatchmakeTestServer;
let tenantId: string;
let tenantSlug: string;
let fixturePackUuid = '';

/**
 * One global (tenantId null) avatar pack so a join that passes onAuth can run
 * to completion. Real fixture row, not a mock: without any pack in scope even
 * a fully authorized join is refused later in onJoin with 526.
 */
async function seedGlobalAvatarPack(): Promise<void> {
  const uuid = `s1r4-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await prisma.avatarPack.create({
    data: {
      uuid,
      name: uuid,
      description: 'session join fixture',
      author: 's1r4-fixture',
      version: '1',
      avatars: [{ key: 'business_man' }],
      tenantId: null,
    },
  });
  packUuids.push(uuid);
  fixturePackUuid = uuid;
}

async function createMember(role: Role = 'member'): Promise<{ id: string; token: string }> {
  const user = await prisma.user.create({
    data: {
      email: `s1r4-${crypto.randomUUID()}@example.test`,
      // Points at the seeded global pack so the avatar allow-list has a hit.
      avatarId: `${fixturePackUuid}:business_man`,
    },
  });
  userIds.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });
  // The session is scoped to the world's tenant, whatever the memberships say.
  const token = jwt.sign({ sub: user.id, tid: tenantId, jti: crypto.randomUUID() }, getJwtSecret(), {
    expiresIn: '1h',
  });
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { id: user.id, token };
}

function joinOptions(identity: string): Record<string, unknown> {
  return {
    tenant: tenantSlug,
    identity,
    // A real client always names its avatar; without one even an authorized
    // join stops later in onJoin (526), which would blur this gate's signal.
    avatarId: `${fixturePackUuid}:business_man`,
    zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
  };
}

interface JoinAttempt {
  room?: Room;
  error?: unknown;
}

async function attemptJoin(identity: string, token?: string): Promise<JoinAttempt> {
  const client = new Client(server.base);
  if (token) client.auth.token = token;
  try {
    const room = await client.joinOrCreate('world', joinOptions(identity));
    return { room };
  } catch (error) {
    return { error };
  }
}

/** A rejected join carries 4401 'unauthorized'; an admitted join is left behind. */
async function expectUnauthorized(attempt: JoinAttempt): Promise<void> {
  if (attempt.room) await attempt.room.leave();
  expect(attempt.error).toMatchObject({ code: AUTH_REJECTED_CODE, message: 'unauthorized' });
}

beforeAll(async () => {
  tenantSlug = `s1r4-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const tenant = await prisma.tenant.create({ data: { slug: tenantSlug, name: tenantSlug } });
  tenantIds.push(tenant.id);
  tenantId = tenant.id;
  await seedGlobalAvatarPack();
  server = await startMatchmakeServer();
});

beforeEach(async () => {
  await disposeAllRooms();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await stopMatchmakeServer(server);
  await prisma.avatarPack.deleteMany({ where: { uuid: { in: packUuids } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

for (const enforced of [undefined, 'true'] as const) {
  describe(`human joins need a live session (enforcement ${enforced ?? 'off'})`, () => {
    beforeEach(() => {
      if (enforced) vi.stubEnv('ZONE_PRIVACY_AUTH_ENFORCE', enforced);
    });

    it('rejects a join with no token, even for the identity of a real member', async () => {
      const member = await createMember();

      await expectUnauthorized(await attemptJoin(member.id));
    });

    it('rejects a join whose session was revoked', async () => {
      const member = await createMember();
      await revokeSessionsForUser(prisma, member.id);

      await expectUnauthorized(await attemptJoin(member.id, member.token));
    });

    it('rejects a join whose account was deleted', async () => {
      const member = await createMember();
      await deleteAccount(prisma, member.id);

      await expectUnauthorized(await attemptJoin(member.id, member.token));
    });

    it('admits a join with a valid token (positive control)', async () => {
      const member = await createMember();

      const { room, error } = await attemptJoin(member.id, member.token);

      expect(error).toBeUndefined();
      expect(room?.sessionId).toEqual(expect.any(String));
      await room?.leave();
    });
  });
}
