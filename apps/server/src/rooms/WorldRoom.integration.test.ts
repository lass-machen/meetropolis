/**
 * Runtime integration test for the Colyseus stack: a REAL Colyseus server
 * (matchmaker HTTP routes + WebSocketTransport on a loopback port), the REAL
 * `WorldRoom` (instance onAuth, onJoin/onLeave lifecycle, per-tenant StateView
 * filter, schema encoding) and the REAL `@colyseus/sdk` client. Only the
 * database is replaced by an in-memory fake, so a protocol, serializer or
 * StateView regression in colyseus / @colyseus/schema fails here even though
 * every other room test drives the handlers with hand-made client objects.
 *
 * Covered: join and initial state sync, tenant isolation of the synced state in
 * a shared room, a state change reaching a peer as a patch, message round trips
 * in both directions, the rejoin path the web client uses after a dropped
 * connection, and an auth rejection reaching the client with its close code.
 */
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'world-room-integration-test-secret';
  process.env.NODE_ENV = 'test';
  // Short graceful-leave window so the rejoin test does not wait for the default.
  process.env.LEAVE_GRACE_MS = '60';
});

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// In-memory stand-in for Prisma. Every model method has a benign default
// (empty list / null / zero); only the rows the join path actually needs are
// backed by data: sessions (token validation), tenants and users.
const fakeDb = vi.hoisted(() => {
  interface SessionRow {
    id: string;
    userId: string;
    expiresAt: Date;
    lastActiveAt: Date;
  }
  interface TenantRow {
    id: string;
    slug: string;
    defaultMapName: string | null;
    bypassLimits: boolean;
    concurrentLimit: number | null;
    freeSeats: number | null;
  }
  interface UserRow {
    id: string;
    name: string;
    email: string;
    avatarId: string | null;
  }
  type Query = { where?: { id?: string; slug?: string; tokenHash?: string; uuid?: string } };

  const sessions = new Map<string, SessionRow>();
  const tenants = new Map<string, TenantRow>();
  const users = new Map<string, UserRow>();

  const backed: Record<string, Record<string, (args: Query) => unknown>> = {
    session: { findUnique: (a) => sessions.get(a.where?.tokenHash ?? '') ?? null },
    tenant: {
      findUnique: (a) => {
        const w = a.where ?? {};
        return [...tenants.values()].find((t) => t.id === w.id || t.slug === w.slug) ?? null;
      },
    },
    user: { findUnique: (a) => users.get(a.where?.id ?? '') ?? null },
    // The join validates the avatar against the tenant's pack scope; only the
    // global default pack the join falls back to exists.
    avatarPack: {
      findFirst: (a) => (a.where?.uuid === 'default-characters' ? { avatars: [{ key: 'business_man' }] } : null),
    },
  };
  const defaults: Record<string, unknown> = { findMany: [], count: 0 };

  function model(name: string) {
    return new Proxy(
      {},
      {
        get(_target, method) {
          // A model must never look thenable to `await`.
          if (typeof method !== 'string' || method === 'then') return undefined;
          const impl = backed[name]?.[method];
          if (impl) return (args: Query) => Promise.resolve(impl(args));
          return () => Promise.resolve(method in defaults ? defaults[method] : null);
        },
      },
    );
  }

  const client = new Proxy(
    { $disconnect: () => Promise.resolve() },
    {
      get(target, prop) {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        if (prop in target) return target[prop as keyof typeof target];
        return model(prop);
      },
    },
  );

  return { sessions, tenants, users, client };
});

vi.mock('../db.js', () => ({ createPrismaClient: () => fakeDb.client }));

import { Server as ColyseusServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from '@colyseus/sdk';
import { ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import { WorldRoom } from './WorldRoom.js';
import { hashSessionToken } from '../api/utils/sessionAuth.js';
import { clearSessionCache } from '../api/utils/sessionCache.js';
import { AUTH_REJECTED_CODE } from './lifecycle/onAuth.js';

// The world room's `Player` fields as the reflected client-side state exposes them.
interface PlayerView {
  identity: string;
  name: string;
  x: number;
  y: number;
  mapId: string;
}
interface WorldView {
  players: { size: number; forEach(cb: (player: PlayerView, sessionId: string) => void): void };
}

// `players` is declared but unset until the first state message has been decoded.
function isWorldView(value: unknown): value is WorldView {
  if (typeof value !== 'object' || value === null || !('players' in value)) return false;
  return typeof value.players === 'object' && value.players !== null;
}

/** Players visible to `room` keyed by identity (identity is the JWT subject). */
function roster(room: Room): Map<string, PlayerView> {
  const out = new Map<string, PlayerView>();
  const state: unknown = room.state;
  if (!isWorldView(state)) return out;
  state.players.forEach((p) => out.set(p.identity, p));
  return out;
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

const TENANT_A = { id: 'tenant-a-id', slug: 'tenant-a' };
const TENANT_B = { id: 'tenant-b-id', slug: 'tenant-b' };

/** The join looks the seat limits of the verified tenant up, so a fixture tenant has to carry some. */
const SEAT_LIMITS = { concurrentLimit: 50, freeSeats: 50 };

let httpServer: HttpServer;
let gameServer: ColyseusServer;
let wsUrl: string;
const openRooms: Room[] = [];

function registerUser(userId: string, name: string): void {
  fakeDb.users.set(userId, { id: userId, name, email: `${userId}@example.test`, avatarId: null });
}

/** Sign a session token for `userId`/`tenantId` and register its session row. */
function issueToken(userId: string, tenantId: string): string {
  const token = jwt.sign({ sub: userId, tid: tenantId }, 'world-room-integration-test-secret', { expiresIn: '1h' });
  fakeDb.sessions.set(hashSessionToken(token), {
    id: `session-${userId}`,
    userId,
    expiresAt: new Date(Date.now() + 3_600_000),
    lastActiveAt: new Date(),
  });
  return token;
}

/**
 * Join the world the way the web client does: a JWT on `client.auth.token`
 * (which the SDK sends as `_authToken`), `tenant: 'default'` as the room
 * partition key (an apex domain yields no subdomain, so every tenant lands in
 * the same WorldRoom) and the zone-privacy protocol version.
 */
async function joinWorld(userId: string, tenantId: string, token = issueToken(userId, tenantId)): Promise<Room> {
  const client = new Client(wsUrl);
  client.auth.token = token;
  const room = await client.joinOrCreate('world', {
    tenant: 'default',
    name: userId,
    zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
  });
  // The room pushes many message types this test does not care about; a no-op
  // wildcard keeps the SDK from warning about every unhandled one.
  room.onMessage('*', () => undefined);
  openRooms.push(room);
  return room;
}

/** Leave without the teardown hook trying to leave the same room a second time. */
async function dropRoom(room: Room, consented: boolean): Promise<void> {
  const at = openRooms.indexOf(room);
  if (at >= 0) openRooms.splice(at, 1);
  await room.leave(consented);
}

beforeAll(async () => {
  fakeDb.tenants.set(TENANT_A.id, { ...TENANT_A, defaultMapName: null, bypassLimits: false, ...SEAT_LIMITS });
  fakeDb.tenants.set(TENANT_B.id, { ...TENANT_B, defaultMapName: null, bypassLimits: false, ...SEAT_LIMITS });
  httpServer = createServer();
  gameServer = new ColyseusServer({ transport: new WebSocketTransport({ server: httpServer }) });
  gameServer.define('world', WorldRoom).filterBy(['tenant']);
  await gameServer.listen(0, '127.0.0.1');
  wsUrl = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await Promise.all(openRooms.splice(0).map((room) => room.leave().catch(() => undefined)));
  clearSessionCache();
  delete process.env.ZONE_PRIVACY_AUTH_ENFORCE;
});

afterAll(async () => {
  await gameServer.gracefullyShutdown(false);
});

describe('WorldRoom over a real Colyseus server and SDK client', () => {
  it('joins, syncs the initial state and binds the identity to the verified token', async () => {
    registerUser('alice', 'Alice');
    const room = await joinWorld('alice', TENANT_A.id);

    await waitFor(() => roster(room).size === 1, 'the joiner to see its own player');
    const me = roster(room).get('alice');
    expect(me?.name).toBe('Alice');
    // The player is keyed by session id, and carries the JWT subject as identity.
    const state: unknown = room.state;
    expect(isWorldView(state) && state.players.size).toBe(1);
  });

  it('keeps tenants apart in a shared room: peers of one tenant see each other, the other tenant sees only itself', async () => {
    registerUser('alice', 'Alice');
    registerUser('anna', 'Anna');
    registerUser('bob', 'Bob');
    const alice = await joinWorld('alice', TENANT_A.id);
    const anna = await joinWorld('anna', TENANT_A.id);
    const bob = await joinWorld('bob', TENANT_B.id);

    // options.tenant is 'default' for everyone, so all three share one WorldRoom.
    expect(anna.roomId).toBe(alice.roomId);
    expect(bob.roomId).toBe(alice.roomId);

    await waitFor(() => roster(alice).size === 2 && roster(anna).size === 2 && roster(bob).size === 1, 'rosters');
    expect([...roster(alice).keys()].sort()).toEqual(['alice', 'anna']);
    expect([...roster(anna).keys()].sort()).toEqual(['alice', 'anna']);
    expect([...roster(bob).keys()]).toEqual(['bob']);
  });

  it('delivers a state change to a same-tenant peer as a patch and never to the other tenant', async () => {
    registerUser('alice', 'Alice');
    registerUser('anna', 'Anna');
    registerUser('bob', 'Bob');
    const alice = await joinWorld('alice', TENANT_A.id);
    const anna = await joinWorld('anna', TENANT_A.id);
    const bob = await joinWorld('bob', TENANT_B.id);
    await waitFor(() => roster(anna).size === 2 && roster(bob).size === 1, 'rosters');

    const moved: unknown[] = [];
    anna.onMessage('player_moved', (m: unknown) => moved.push(m));
    alice.send('move', { x: 321, y: 123, direction: 'left' });

    await waitFor(() => roster(anna).get('alice')?.x === 321, 'anna to receive the schema patch');
    expect(roster(anna).get('alice')).toMatchObject({ x: 321, y: 123 });
    // The same move also travels as a room message to peers on the same map.
    await waitFor(() => moved.length === 1, 'the player_moved message');
    expect(moved[0]).toMatchObject({ x: 321, y: 123, direction: 'left' });
    // Bob (other tenant) still only knows himself, and his own record is untouched.
    expect([...roster(bob).keys()]).toEqual(['bob']);
  });

  it('round-trips messages in both directions', async () => {
    registerUser('alice', 'Alice');
    const room = await joinWorld('alice', TENANT_A.id);

    // server -> client: the delayed full_state seed the room sends after the join.
    const fullState: { players: { identity: string }[] }[] = [];
    room.onMessage('full_state', (m: { players: { identity: string }[] }) => fullState.push(m));
    // client -> server -> client: remote_control is echoed back to the sender.
    const echoed: unknown[] = [];
    room.onMessage('remote_control', (m: unknown) => echoed.push(m));
    room.send('remote_control', { action: 'ping', nested: { n: 1 } });

    await waitFor(() => echoed.length === 1, 'the echoed remote_control message');
    expect(echoed[0]).toEqual({ action: 'ping', nested: { n: 1 } });
    await waitFor(() => fullState.length === 1, 'the full_state seed');
    expect(fullState[0]?.players.map((p) => p.identity)).toEqual(['alice']);
  });

  it('heals a dropped connection: the rejoin replaces the old player and peers converge', async () => {
    registerUser('alice', 'Alice');
    registerUser('anna', 'Anna');
    const alice = await joinWorld('alice', TENANT_A.id);
    const anna = await joinWorld('anna', TENANT_A.id);
    await waitFor(() => roster(anna).size === 2, 'both players to be visible');
    const firstSession = alice.sessionId;

    // Non-consented leave: the room keeps the player for LEAVE_GRACE_MS.
    await dropRoom(alice, false);
    const rejoined = await joinWorld('alice', TENANT_A.id);

    expect(rejoined.sessionId).not.toBe(firstSession);
    await waitFor(() => roster(rejoined).size === 2, 'the rejoined client to see both players');
    // Exactly one player per identity, on both sides, once the old one is gone.
    await waitFor(() => {
      const state: unknown = anna.state;
      return isWorldView(state) && state.players.size === 2;
    }, 'the stale player entry to disappear for the peer');
    expect([...roster(anna).keys()].sort()).toEqual(['alice', 'anna']);
    expect([...roster(rejoined).keys()].sort()).toEqual(['alice', 'anna']);

    // The rejoined session is live: its moves reach the peer.
    rejoined.send('move', { x: 55, y: 66, direction: 'up' });
    await waitFor(() => roster(anna).get('alice')?.x === 55, 'a move from the rejoined session');
  });

  it('rejects an unauthenticated join with the auth close code when enforcement is on', async () => {
    process.env.ZONE_PRIVACY_AUTH_ENFORCE = 'true';
    const client = new Client(wsUrl);
    client.auth.token = 'not-a-valid-token';
    const attempt = client.joinOrCreate('world', {
      tenant: 'default',
      zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
    });
    await expect(attempt).rejects.toMatchObject({ code: AUTH_REJECTED_CODE });
  });
});
