/**
 * World authentication and live world access through the real stack.
 *
 * A real Colyseus server with the real `WorldRoom` (see
 * testUtils/matchmakeHarness.ts), a real PostgreSQL database (db.js is NOT
 * mocked) and real @colyseus/sdk clients. The HTTP API the loadtest login
 * needs runs on the same server through `configureApp` (cookieParser, the
 * tenant middleware and registerApi, as in the tenant isolation test).
 *
 * Ten cases below fail on the unfixed basis: matchmaking without a
 * session reserves a seat, a consumed seat survives its deleted session row
 * through the session cache, a running member flagged for verification is
 * neither swept nor revoked, an old protocol version is admitted while the
 * enforcement flag is missing or false, insecure service secrets and
 * record-less service joins are admitted, and the legacy loadtest bot never
 * presents the account credentials. The nine controls hold with and without
 * the fix: a room slug that is not the session tenant is admitted with a
 * warning while the tenant enforcement is off and refused while it is on,
 * and a session whose tenant claim names a foreign tenant is refused.
 *
 * Three more cases cover the default of the tenant enforcement, which is on
 * unless ZONE_PRIVACY_TENANT_ENFORCE is exactly `false`. With the flag unset a
 * member of one tenant is refused at another tenant's room (fails while the
 * default is off) and the room's own member gets in; with the explicit
 * `false` the own member gets in as well.
 */

import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import type { AuthContext } from '@colyseus/core';
import { MIN_ZONE_PRIVACY_CLIENT_VERSION, ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import { createPrismaClient } from '../../db.js';
import { registerApi } from '../../api.js';
import { tenantMiddleware } from '../../tenancy.js';
import { validateSessionToken } from '../../api/utils/sessionAuth.js';
import { broadcastAccessRevoked } from '../../api/utils/broadcast.js';
import { logger } from '../../logger.js';
import { authenticateWorldJoin } from './onAuth.js';
import { cleanupTenants, issueSession, seedMember, seedTenant } from '../../testUtils/worldSeed.js';
import {
  disposeAllRooms,
  matchmake,
  rawPost,
  startMatchmakeServer,
  stopMatchmakeServer,
  worldRooms,
  type MatchmakeTestServer,
} from '../../testUtils/matchmakeHarness.js';
import { spawnColyseusBot } from '../../../../loadtest/src/workers/colyseusBot.js';

/**
 * Matchmaking answers a refused world auth with the HTTP status that the
 * WebSocket close code mirrors (4401 -> 401, 4426 -> 426), see
 * toMatchmakeError in worldMatchmakeAuth.ts.
 */
const MATCHMAKE_AUTH_REJECTED_STATUS = 401;
const MATCHMAKE_CLIENT_TOO_OLD_STATUS = 426;

if (!process.env.DATABASE_URL) {
  throw new Error('worldAccessSecurity.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const FILE = 'worldAccessSecurity.integration.test.ts';
const FORGED_HEADER_IP = '203.0.113.9';
/** The warning the room logs when it admits a slug that is not the session tenant. */
const ADMITTED_MISMATCH_WARNING =
  '[WorldRoom] Admitted join with options.tenant != authenticated tenant (enforcement off)';

process.env.DEFAULT_TENANT_SLUG = `wsec-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

const prisma = createPrismaClient();
const packUuids: string[] = [];
let server: MatchmakeTestServer;
let previousGameServer: typeof global.gameServer;
let tenantId = '';
let tenantSlug = '';
let fixturePackUuid = '';
/** Tenants the slug cases add; the cleanup list removes them with the default one. */
const extraTenantIds: string[] = [];

/**
 * One global (tenantId null) avatar pack so a join that passes the gate can
 * run to completion. Real fixture row, not a mock: without any pack in scope
 * even a fully authorized join is refused later in onJoin.
 */
async function seedGlobalAvatarPack(): Promise<void> {
  const uuid = `wsec-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await prisma.avatarPack.create({
    data: {
      uuid,
      name: uuid,
      description: 'world access join fixture',
      author: 'wsec-fixture',
      version: '1',
      avatars: [{ key: 'business_man' }],
      tenantId: null,
    },
  });
  packUuids.push(uuid);
  fixturePackUuid = uuid;
}

function baseJoinOptions(): Record<string, unknown> {
  return {
    tenant: tenantSlug,
    // A real client always names its avatar; without one even an authorized
    // join stops later in onJoin, which would blur the gate's signal.
    avatarId: `${fixturePackUuid}:business_man`,
    zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
  };
}

interface TrackedJoin {
  room?: Room;
  error?: unknown;
  left: boolean;
  errorMessages: unknown[];
}

async function joinWorld(
  identity: string,
  token: string | undefined,
  extra?: Record<string, unknown>,
): Promise<TrackedJoin> {
  const client = new Client(server.base);
  if (token) client.auth.token = token;
  const tracked: TrackedJoin = { left: false, errorMessages: [] };
  try {
    const room = await client.joinOrCreate('world', { ...baseJoinOptions(), identity, ...extra });
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
async function waitForLeft(tracked: TrackedJoin, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!tracked.left) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

/** Cleanup-only leave: never fail the test, never hang on a swept room. */
async function leaveQuietly(tracked: TrackedJoin): Promise<void> {
  if (tracked.left || !tracked.room) return;
  await Promise.race([tracked.room.leave().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 3_000))]);
}

/**
 * Real waiting with polling on the condition: the client state reaches the
 * client after the join resolved, so the roster is read with a deadline and
 * never with a fixed sleep as proof.
 */
async function waitForPlayers(tracked: TrackedJoin, timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const seen = tracked.room ? [...tracked.room.state.players.values()].map((player) => player.identity) : [];
    if (seen.length > 0 || Date.now() > deadline) return seen;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Flag a membership as needing verification (field from the session basis). */
async function setVerificationFlag(userId: string, flagged: boolean): Promise<void> {
  await prisma.membership.update({
    where: { tenantId_userId: { tenantId, userId } },
    data: { inviteVerificationRequired: flagged },
  });
}

/** Swap the service secret for one join; the caller restores in a finally. */
function useServiceSecret(value: string | undefined): () => void {
  const previous = process.env.NPC_SERVICE_SECRET;
  if (value === undefined) delete process.env.NPC_SERVICE_SECRET;
  else process.env.NPC_SERVICE_SECRET = value;
  return () => {
    if (previous === undefined) delete process.env.NPC_SERVICE_SECRET;
    else process.env.NPC_SERVICE_SECRET = previous;
  };
}

/** Swap the tenant-enforcement flag for one join; the caller restores it. */
function useTenantEnforcement(value: string | undefined): () => void {
  const previous = process.env.ZONE_PRIVACY_TENANT_ENFORCE;
  if (value === undefined) delete process.env.ZONE_PRIVACY_TENANT_ENFORCE;
  else process.env.ZONE_PRIVACY_TENANT_ENFORCE = value;
  return () => {
    if (previous === undefined) delete process.env.ZONE_PRIVACY_TENANT_ENFORCE;
    else process.env.ZONE_PRIVACY_TENANT_ENFORCE = previous;
  };
}

/** A second, real tenant whose slug a join can name; the cleanup list removes it. */
async function seedSecondTenant(): Promise<{ id: string; slug: string }> {
  const tenant = await seedTenant(prisma);
  extraTenantIds.push(tenant.id);
  return tenant;
}

/** Join with an outdated protocol version under the given enforcement flag. */
async function joinWithOldVersion(authFlag: string | undefined): Promise<TrackedJoin> {
  const previous = process.env.ZONE_PRIVACY_AUTH_ENFORCE;
  try {
    if (authFlag === undefined) delete process.env.ZONE_PRIVACY_AUTH_ENFORCE;
    else process.env.ZONE_PRIVACY_AUTH_ENFORCE = authFlag;
    const member = await seedMember(prisma, tenantId);
    return await joinWorld(member.userId, member.token, {
      zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION - 1,
    });
  } finally {
    if (previous === undefined) delete process.env.ZONE_PRIVACY_AUTH_ENFORCE;
    else process.env.ZONE_PRIVACY_AUTH_ENFORCE = previous;
  }
}

function configureApi(app: express.Express): void {
  app.use(cookieParser());
  app.use(express.json());
  app.use(tenantMiddleware as unknown as express.RequestHandler);
  // Async wiring without awaits before listen: the first API request arrives
  // long after this resolves, so the table is complete by then.
  void registerApi(app);
}

beforeAll(async () => {
  vi.stubEnv('WORLD_ACCESS_SWEEP_MS', '1000');
  tenantSlug = process.env.DEFAULT_TENANT_SLUG as string;
  tenantId = (await seedTenant(prisma, { slug: tenantSlug })).id;
  await seedGlobalAvatarPack();
  await prisma.map.create({ data: { tenantId, name: 'office', meta: {} } });
  server = await startMatchmakeServer({ configureApp: configureApi });
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
  vi.unstubAllEnvs();
  await stopMatchmakeServer(server);
  global.gameServer = previousGameServer;
  await prisma.presence.deleteMany({ where: { tenantId } });
  await prisma.room.deleteMany({ where: { tenantId } });
  await prisma.npc.deleteMany({ where: { tenantId } });
  await prisma.map.deleteMany({ where: { tenantId } });
  await prisma.avatarPack.deleteMany({ where: { uuid: { in: packUuids } } });
  await cleanupTenants(prisma, [tenantId, ...extraTenantIds]);
  await prisma.$disconnect();
});

describe('world matchmaking without a session', () => {
  it('refuses a forged forwarded header without reserving a seat', async () => {
    const body = JSON.stringify({ ...baseJoinOptions(), identity: 'wsec-stranger' });
    const status = await rawPost(
      server,
      {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
        'x-forwarded-for': FORGED_HEADER_IP,
      },
      (req) => req.end(body),
    );
    expect(status).not.toBe(200);
    expect(await worldRooms()).toHaveLength(0);
  }, 30_000);
});

describe('world matchmaking with a revoked session', () => {
  it('refuses a deleted session without reserving a seat', async () => {
    const member = await seedMember(prisma, tenantId);
    await prisma.session.deleteMany({ where: { userId: member.userId } });
    const reservation = await matchmake(server, JSON.stringify(baseJoinOptions()), {
      headers: { Cookie: `auth_token=${member.token}` },
    });
    expect(reservation.status).not.toBe(200);
    expect(await worldRooms()).toHaveLength(0);
  }, 30_000);
});

describe('world seat consumed after the session row is gone', () => {
  it('rejects the join and publishes no player', async () => {
    const member = await seedMember(prisma, tenantId);
    const first = await joinWorld(member.userId, member.token);
    expect(first.error, 'first join with a live session must succeed').toBeUndefined();
    // Fill the shared session cache, then remove the row it points at.
    expect(await validateSessionToken(prisma, member.token)).not.toBeNull();
    await leaveQuietly(first);
    await prisma.session.deleteMany({ where: { userId: member.userId } });

    const second = await joinWorld(member.userId, member.token);
    await leaveQuietly(second);
    expect(second.error).toMatchObject({ code: MATCHMAKE_AUTH_REJECTED_STATUS });

    const controlMember = await seedMember(prisma, tenantId);
    const control = await joinWorld(controlMember.userId, controlMember.token);
    try {
      expect(control.error, 'control join must succeed').toBeUndefined();
      if (!control.room) throw new Error(`${FILE} control join created no room`);
      const seen = [...control.room.state.players.values()].map((player) => player.identity);
      expect(seen).not.toContain(member.userId);
    } finally {
      await leaveQuietly(control);
    }
  }, 30_000);
});

describe('running member flagged for verification', () => {
  it('ends the world session on the next sweep', async () => {
    const member = await seedMember(prisma, tenantId);
    const tracked = await joinWorld(member.userId, member.token);
    expect(tracked.error, 'join must succeed before the flag is set').toBeUndefined();
    if (!tracked.room) throw new Error(`${FILE} join created no room before the flag is set`);
    await setVerificationFlag(member.userId, true);
    const left = await waitForLeft(tracked, 8_000);
    await leaveQuietly(tracked);
    expect(left).toBe(true);
  }, 30_000);

  it('ends the world session on the revocation event', async () => {
    const member = await seedMember(prisma, tenantId);
    const tracked = await joinWorld(member.userId, member.token);
    expect(tracked.error, 'join must succeed before the flag is set').toBeUndefined();
    if (!tracked.room) throw new Error(`${FILE} join created no room before the flag is set`);
    await setVerificationFlag(member.userId, true);
    broadcastAccessRevoked(member.userId);
    const left = await waitForLeft(tracked, 5_000);
    await leaveQuietly(tracked);
    expect(left).toBe(true);
  }, 30_000);
});

describe('old zone protocol without enforcement', () => {
  it('rejects an old client when the flag is missing', async () => {
    const tracked = await joinWithOldVersion(undefined);
    await leaveQuietly(tracked);
    expect(tracked.error).toMatchObject({ code: MATCHMAKE_CLIENT_TOO_OLD_STATUS });
    expect(tracked.room).toBeUndefined();
  }, 30_000);

  it('rejects an old client when the flag is false', async () => {
    const tracked = await joinWithOldVersion('false');
    await leaveQuietly(tracked);
    expect(tracked.error).toMatchObject({ code: MATCHMAKE_CLIENT_TOO_OLD_STATUS });
    expect(tracked.room).toBeUndefined();
  }, 30_000);
});

describe('insecure service secret', () => {
  it('reserves no seat for any insecure secret variant', async () => {
    const variants = [
      { name: 'missing', secret: undefined, presented: 'dev-npc-secret' },
      { name: 'blank', secret: '   ', presented: '   ' },
      { name: 'default', secret: 'dev-npc-secret', presented: 'dev-npc-secret' },
      { name: 'short', secret: 'x'.repeat(31), presented: 'x'.repeat(31) },
    ];
    for (const variant of variants) {
      const restore = useServiceSecret(variant.secret);
      try {
        const identity = `npc-wsec-${variant.name}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
        const tracked = await joinWorld(identity, undefined, { serviceToken: variant.presented });
        await leaveQuietly(tracked);
        expect(tracked.error, `variant ${variant.name} must be refused`).toMatchObject({
          code: MATCHMAKE_AUTH_REJECTED_STATUS,
        });
        expect(tracked.room, `variant ${variant.name} must reserve nothing`).toBeUndefined();
      } finally {
        restore();
      }
    }
  }, 30_000);
});

describe('service join without a matching record', () => {
  it('reserves no seat without a record in the tenant', async () => {
    const secret = crypto.randomBytes(32).toString('hex');
    const restore = useServiceSecret(secret);
    try {
      const identity = `npc-wsec-orphan-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
      const tracked = await joinWorld(identity, undefined, { serviceToken: secret });
      await leaveQuietly(tracked);
      expect(tracked.error).toMatchObject({ code: MATCHMAKE_AUTH_REJECTED_STATUS });
      expect(tracked.room).toBeUndefined();
    } finally {
      restore();
    }
  }, 30_000);
});

describe('regular account through the loadtest bot', () => {
  it('reaches the world under the account identity', async () => {
    const password = `wsec-${crypto.randomUUID()}`;
    const member = await seedMember(prisma, tenantId, {
      email: `wsec-${crypto.randomUUID()}@example.test`,
      password,
    });
    let joined: { userId?: unknown; stop?: () => Promise<void> } | undefined;
    let joinError: unknown;
    try {
      joined = await spawnColyseusBot({ apiBase: server.base, tenant: tenantSlug, email: member.email, password });
    } catch (error) {
      joinError = error;
    }
    try {
      expect(joinError, 'bot login and world join must succeed').toBeUndefined();
      expect(joined?.userId).toBe(member.userId);
    } finally {
      await joined?.stop?.();
    }
  }, 30_000);
});

describe('proven sessions keep working', () => {
  it('accepts a bearer session and a cookie session', async () => {
    const member = await seedMember(prisma, tenantId);
    const context = { headers: new Headers(), ip: '127.0.0.1' };
    const bearer = await authenticateWorldJoin(baseJoinOptions(), { ...context, token: member.token }, prisma);
    expect(bearer.identity).toBe(member.userId);
    const cookie = await authenticateWorldJoin(
      baseJoinOptions(),
      { ...context, headers: new Headers({ cookie: `auth_token=${member.token}` }) },
      prisma,
    );
    expect(cookie.identity).toBe(member.userId);
    const tracked = await joinWorld(member.userId, member.token);
    await leaveQuietly(tracked);
    expect(tracked.error).toBeUndefined();
    expect(tracked.room?.sessionId).toEqual(expect.any(String));
  }, 30_000);

  it('ignores a foreign identity option', async () => {
    const member = await seedMember(prisma, tenantId);
    const context = { token: member.token, headers: new Headers(), ip: '127.0.0.1' } as AuthContext;
    const auth = await authenticateWorldJoin({ ...baseJoinOptions(), identity: 'wsec-stranger' }, context, prisma);
    expect(auth.identity).toBe(member.userId);
    const tracked = await joinWorld('wsec-stranger', member.token);
    await leaveQuietly(tracked);
    expect(tracked.error).toBeUndefined();
  }, 30_000);

  it('accepts the current protocol version', async () => {
    const member = await seedMember(prisma, tenantId);
    const tracked = await joinWorld(member.userId, member.token);
    await leaveQuietly(tracked);
    expect(tracked.error).toBeUndefined();
    expect(tracked.room?.sessionId).toEqual(expect.any(String));
  }, 30_000);

  it('refuses a join flagged before join', async () => {
    const member = await seedMember(prisma, tenantId);
    await setVerificationFlag(member.userId, true);
    const tracked = await joinWorld(member.userId, member.token);
    await leaveQuietly(tracked);
    expect(tracked.error).toMatchObject({ code: MATCHMAKE_AUTH_REJECTED_STATUS });
  }, 30_000);

  it('keeps a valid session despite a forwarded header', async () => {
    const member = await seedMember(prisma, tenantId);
    const context = {
      token: member.token,
      headers: new Headers({ 'x-forwarded-for': FORGED_HEADER_IP, 'x-real-ip': FORGED_HEADER_IP }),
      ip: FORGED_HEADER_IP,
    } as AuthContext;
    const auth = await authenticateWorldJoin(baseJoinOptions(), context, prisma);
    expect(auth.identity).toBe(member.userId);
  }, 30_000);

  it('admits a service client with a secure secret and a matching record', async () => {
    const secret = crypto.randomBytes(32).toString('hex');
    const restore = useServiceSecret(secret);
    const recordIdentity = `wsec-attendant-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    await prisma.npc.create({ data: { tenantId, identity: recordIdentity, name: recordIdentity } });
    try {
      const tracked = await joinWorld(`npc-${recordIdentity}`, undefined, { serviceToken: secret });
      await leaveQuietly(tracked);
      expect(tracked.error).toBeUndefined();
      expect(tracked.room?.sessionId).toEqual(expect.any(String));
    } finally {
      restore();
    }
  }, 30_000);
});

describe('room slug and session tenant', () => {
  it('admits a member at its own tenant room while the flag is unset', async () => {
    const other = await seedSecondTenant();
    const owner = await seedMember(prisma, other.id);
    const restore = useTenantEnforcement(undefined);
    try {
      const tracked = await joinWorld(owner.userId, owner.token, { tenant: other.slug });
      try {
        expect(tracked.error, 'a member must reach the room of its own tenant').toBeUndefined();
        if (!tracked.room) throw new Error(`${FILE} the member join created no room`);
        const seen = await waitForPlayers(tracked, 5_000);
        expect(seen).toContain(owner.userId);
      } finally {
        await leaveQuietly(tracked);
      }
    } finally {
      restore();
    }
  }, 30_000);

  it('refuses a member of another tenant at that room while the flag is unset', async () => {
    const other = await seedSecondTenant();
    const owner = await seedMember(prisma, other.id);
    const stranger = await seedMember(prisma, tenantId);
    const restore = useTenantEnforcement(undefined);
    try {
      // The owner opens the room first, so the stranger targets an existing room of the other tenant.
      const ownerJoin = await joinWorld(owner.userId, owner.token, { tenant: other.slug });
      try {
        expect(ownerJoin.error, 'the owner must reach its own room').toBeUndefined();
        const strangerJoin = await joinWorld(stranger.userId, stranger.token, { tenant: other.slug });
        await leaveQuietly(strangerJoin);
        expect(strangerJoin.error).toMatchObject({ code: MATCHMAKE_AUTH_REJECTED_STATUS, message: 'tenant_mismatch' });
        expect(strangerJoin.room).toBeUndefined();
        const seen = await waitForPlayers(ownerJoin, 5_000);
        expect(seen, 'the room must not list the refused stranger').not.toContain(stranger.userId);
      } finally {
        await leaveQuietly(ownerJoin);
      }
    } finally {
      restore();
    }
  }, 30_000);

  it('admits a member at its own tenant room while tenant enforcement is explicitly off', async () => {
    const other = await seedSecondTenant();
    const owner = await seedMember(prisma, other.id);
    const restore = useTenantEnforcement('false');
    try {
      const tracked = await joinWorld(owner.userId, owner.token, { tenant: other.slug });
      try {
        expect(tracked.error, 'a member must reach the room of its own tenant').toBeUndefined();
        if (!tracked.room) throw new Error(`${FILE} the member join created no room`);
        const seen = await waitForPlayers(tracked, 5_000);
        expect(seen).toContain(owner.userId);
      } finally {
        await leaveQuietly(tracked);
      }
    } finally {
      restore();
    }
  }, 30_000);

  it('admits a mismatched room slug with a warning while tenant enforcement is explicitly off', async () => {
    const other = await seedSecondTenant();
    const member = await seedMember(prisma, tenantId);
    const restore = useTenantEnforcement('false');
    const warnSpy = vi.spyOn(logger, 'warn');
    try {
      // A foreign identity option: the player must still carry the session identity.
      const tracked = await joinWorld('wsec-stranger', member.token, { tenant: other.slug });
      try {
        expect(tracked.error, 'the join must be admitted while tenant enforcement is off').toBeUndefined();
        if (!tracked.room) throw new Error(`${FILE} the admitted join created no room`);
        const seen = await waitForPlayers(tracked, 5_000);
        expect(seen, 'the player must carry the session identity').toContain(member.userId);
        expect(seen, 'the client identity must not become the player identity').not.toContain('wsec-stranger');
      } finally {
        await leaveQuietly(tracked);
      }
      expect(warnSpy).toHaveBeenCalledWith(
        ADMITTED_MISMATCH_WARNING,
        expect.objectContaining({ requested: other.slug, authenticated: tenantSlug }),
      );
    } finally {
      warnSpy.mockRestore();
      restore();
    }
  }, 30_000);

  it('refuses a mismatched room slug while tenant enforcement is on', async () => {
    const other = await seedSecondTenant();
    const member = await seedMember(prisma, tenantId);
    const restore = useTenantEnforcement('true');
    try {
      const tracked = await joinWorld(member.userId, member.token, { tenant: other.slug });
      await leaveQuietly(tracked);
      expect(tracked.error).toMatchObject({ code: MATCHMAKE_AUTH_REJECTED_STATUS, message: 'tenant_mismatch' });
      expect(tracked.room).toBeUndefined();
    } finally {
      restore();
    }
  }, 30_000);

  it('refuses a session whose tenant claim names a foreign tenant', async () => {
    const other = await seedSecondTenant();
    const member = await seedMember(prisma, tenantId);
    // A live session whose `tid` claim names the other tenant; the user is a
    // member of the default tenant only.
    const foreign = await issueSession(prisma, member.userId, other.id);
    const tracked = await joinWorld(member.userId, foreign.token, { tenant: other.slug });
    await leaveQuietly(tracked);
    expect(tracked.error).toMatchObject({ code: MATCHMAKE_AUTH_REJECTED_STATUS });
    expect(tracked.room).toBeUndefined();
  }, 30_000);
});
