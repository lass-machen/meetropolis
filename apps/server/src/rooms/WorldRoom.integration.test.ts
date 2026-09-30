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
 * connection, the join authority (the instance onAuth alone decides, over the
 * SDK token path and the browser cookie path, with its close codes) and the
 * mobile world bridge joining, syncing and reconnecting.
 */
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo, Socket } from 'net';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
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

import { Server as ColyseusServer, matchMaker, Protocol } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from '@colyseus/sdk';
import { MIN_ZONE_PRIVACY_CLIENT_VERSION, ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import { WorldRoom } from './WorldRoom.js';
import { hashSessionToken } from '../api/utils/sessionAuth.js';
import { clearSessionCache } from '../api/utils/sessionCache.js';
import { AUTH_REJECTED_CODE, CLIENT_TOO_OLD_CODE, isWorldAuth } from './lifecycle/onAuth.js';
import { WorldBridge } from '../mobile/worldBridge.js';
import type { MobileServerEvent } from '../mobile/protocol.js';

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

/** Players in a room state keyed by identity (identity is the JWT subject). */
function playersByIdentity(state: unknown): Map<string, PlayerView> {
  const out = new Map<string, PlayerView>();
  if (!isWorldView(state)) return out;
  state.players.forEach((p) => out.set(p.identity, p));
  return out;
}

/** Players visible to `room` (a client room sees only its own tenant's players). */
function roster(room: Room): Map<string, PlayerView> {
  return playersByIdentity(room.state);
}

async function waitFor(predicate: () => boolean | Promise<boolean>, what: string, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
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
let httpUrl: string;
// Notices Colyseus printed while registering the world room; see the guard test.
let registrationNotices: string[] = [];
// Every TCP connection the server currently holds, to simulate a network drop.
const liveSockets = new Set<Socket>();
const openRooms: Room[] = [];
const openBridges: WorldBridge[] = [];
const openSockets: WebSocket[] = [];

function registerUser(userId: string, name: string): void {
  fakeDb.users.set(userId, { id: userId, name, email: `${userId}@example.test`, avatarId: null });
}

/** A correctly signed token; whether a session row backs it is up to the caller. */
function signToken(userId: string, tenantId: string): string {
  return jwt.sign({ sub: userId, tid: tenantId }, 'world-room-integration-test-secret', { expiresIn: '1h' });
}

/** Sign a session token for `userId`/`tenantId` and register its session row. */
function issueToken(userId: string, tenantId: string): string {
  const token = signToken(userId, tenantId);
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

const SeatReservation = z.object({ roomId: z.string(), processId: z.string(), sessionId: z.string() });

interface RawJoin {
  roomId: string;
  /** Protocol code (first byte) of every frame the server sent, in order. */
  frames: number[];
}

/**
 * Join the way a browser does, without the SDK: reserve a seat over the
 * matchmaker HTTP route, then open the WebSocket by hand. That lets the
 * identity travel ONLY as the `auth_token` cookie on the upgrade request, which
 * the SDK client cannot do from Node. Resolves on the first JOIN_ROOM frame or
 * when the server closes the socket, whichever comes first.
 */
async function rawJoin(headers: Record<string, string> = {}): Promise<RawJoin> {
  const res = await fetch(`${httpUrl}/matchmake/joinOrCreate/world`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ tenant: 'default', name: 'raw', zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION }),
  });
  const seat = SeatReservation.parse(await res.json());
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsUrl}/${seat.processId}/${seat.roomId}?sessionId=${seat.sessionId}`, { headers });
    openSockets.push(socket);
    socket.binaryType = 'arraybuffer';
    const frames: number[] = [];
    const timer = setTimeout(() => reject(new Error('raw join timed out')), 4_000);
    const done = () => {
      clearTimeout(timer);
      resolve({ roomId: seat.roomId, frames });
    };
    socket.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      const code = new Uint8Array(ev.data)[0];
      if (code === undefined) return;
      frames.push(code);
      if (code === Protocol.JOIN_ROOM) done();
    };
    socket.onclose = done;
  });
}

/**
 * A join that must be refused: the SDK client sees the close code, and a
 * browser-style raw join receives only the ERROR frame, never JOIN_ROOM or state.
 */
async function expectJoinRejected(token: string | undefined, code: number): Promise<void> {
  const client = new Client(wsUrl);
  if (token) client.auth.token = token;
  const attempt = client.joinOrCreate('world', {
    tenant: 'default',
    zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
  });
  await expect(attempt).rejects.toMatchObject({ code });

  const raw = await rawJoin(token ? { cookie: `auth_token=${encodeURIComponent(token)}` } : {});
  expect(raw.frames).toEqual([Protocol.ERROR]);
}

/** Session ids the world rooms currently hold for `identity`. */
async function serverSessionsOf(identity: string): Promise<string[]> {
  const sessions: string[] = [];
  for (const { roomId } of await matchMaker.query({ name: 'world' })) {
    matchMaker.getLocalRoomById(roomId)?.clients.forEach((c) => {
      if (isWorldAuth(c.auth) && c.auth.identity === identity) sessions.push(c.sessionId);
    });
  }
  return sessions;
}

/** A mobile bridge for `token` plus the events it emitted so far. */
function openBridge(token: string): { bridge: WorldBridge; events: MobileServerEvent[] } {
  const events: MobileServerEvent[] = [];
  const bridge = new WorldBridge({
    serverUrl: httpUrl,
    authToken: token,
    tenantSlug: 'default',
    zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
    emit: (event) => events.push(event),
  });
  openBridges.push(bridge);
  return { bridge, events };
}

/** Identities in the newest roster event the bridge emitted, or null if none yet. */
function latestRoster(events: MobileServerEvent[]): string[] | null {
  const last = [...events].reverse().find((e) => e.type === 'roster');
  return last?.type === 'roster' ? last.players.map((p) => p.identity) : null;
}

beforeAll(async () => {
  fakeDb.tenants.set(TENANT_A.id, { ...TENANT_A, defaultMapName: null, bypassLimits: false, ...SEAT_LIMITS });
  fakeDb.tenants.set(TENANT_B.id, { ...TENANT_B, defaultMapName: null, bypassLimits: false, ...SEAT_LIMITS });
  httpServer = createServer();
  httpServer.on('connection', (socket) => {
    liveSockets.add(socket);
    socket.on('close', () => liveSockets.delete(socket));
  });
  gameServer = new ColyseusServer({ transport: new WebSocketTransport({ server: httpServer }) });
  const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  gameServer.define('world', WorldRoom).filterBy(['tenant']);
  registrationNotices = info.mock.calls.map((args) => args.join(' '));
  info.mockRestore();
  await gameServer.listen(0, '127.0.0.1');
  const port = (httpServer.address() as AddressInfo).port;
  wsUrl = `ws://127.0.0.1:${port}`;
  httpUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  openSockets.splice(0).forEach((socket) => socket.close());
  await Promise.all(openBridges.splice(0).map((bridge) => bridge.dispose()));
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

describe('WorldRoom join authority over a real Colyseus server', () => {
  it('registers the room without the framework shadowing its instance onAuth', () => {
    // Colyseus prints this when the room class carries a static onAuth of its
    // own (or a second copy of Room is in play). The static hook would then
    // decide who may join and the session-row check in the instance onAuth
    // would no longer be the authority.
    expect(registrationNotices.filter((line) => line.includes('will be ignored'))).toEqual([]);
  });

  it('admits the browser path: a cookie-only join with enforcement on, bound to the token subject', async () => {
    process.env.ZONE_PRIVACY_AUTH_ENFORCE = 'true';
    registerUser('carol', 'Carol');
    const token = issueToken('carol', TENANT_A.id);

    const join = await rawJoin({ cookie: `auth_token=${encodeURIComponent(token)}` });

    expect(join.frames[0]).toBe(Protocol.JOIN_ROOM);
    // The client-supplied name says 'raw'; the identity must be the token subject.
    const serverState: unknown = matchMaker.getLocalRoomById(join.roomId)?.state;
    expect([...playersByIdentity(serverState).keys()]).toEqual(['carol']);
  });

  it('refuses a token-less join with 4401 when enforcement is on, before any state', async () => {
    process.env.ZONE_PRIVACY_AUTH_ENFORCE = 'true';
    await expectJoinRejected(undefined, AUTH_REJECTED_CODE);
  });

  it('refuses a correctly signed token without a session row (revoked) with 4401, before any state', async () => {
    process.env.ZONE_PRIVACY_AUTH_ENFORCE = 'true';
    await expectJoinRejected(signToken('ghost', TENANT_A.id), AUTH_REJECTED_CODE);
  });

  it('refuses a client below the minimum zone-privacy version with the update code 4426', async () => {
    process.env.ZONE_PRIVACY_AUTH_ENFORCE = 'true';
    registerUser('olga', 'Olga');
    const client = new Client(wsUrl);
    client.auth.token = issueToken('olga', TENANT_A.id);
    const attempt = client.joinOrCreate('world', {
      tenant: 'default',
      zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION - 1,
    });
    await expect(attempt).rejects.toMatchObject({ code: CLIENT_TOO_OLD_CODE });
  });
});

describe('WorldBridge against the real world room', () => {
  it('projects the room state into roster events and forwards moves to peers', async () => {
    registerUser('mob', 'Mob');
    registerUser('peer', 'Peer');
    const { bridge, events } = openBridge(issueToken('mob', TENANT_A.id));
    await bridge.connect();
    await waitFor(() => latestRoster(events)?.includes('mob') === true, 'the bridge to see itself');

    const peer = await joinWorld('peer', TENANT_A.id);
    await waitFor(() => latestRoster(events)?.includes('peer') === true, 'the roster to include the peer');
    bridge.send('move', { x: 77, y: 88, direction: 'left' });
    await waitFor(() => roster(peer).get('mob')?.x === 77, 'the peer to see the bridge move');
  });

  it('fails the connect with the auth code and emits no roster when the token is refused', async () => {
    process.env.ZONE_PRIVACY_AUTH_ENFORCE = 'true';
    const { bridge, events } = openBridge('not-a-valid-token');
    await expect(bridge.connect()).rejects.toMatchObject({ code: AUTH_REJECTED_CODE });
    expect(events.filter((e) => e.type === 'roster')).toEqual([]);
  });

  it('reconnects with a fresh session after the transport drops', async () => {
    registerUser('mob2', 'Mob2');
    registerUser('peer2', 'Peer2');
    const { bridge, events } = openBridge(issueToken('mob2', TENANT_A.id));
    await bridge.connect();
    await waitFor(() => latestRoster(events)?.includes('mob2') === true, 'the first roster');
    const [firstSession] = await serverSessionsOf('mob2');

    // Only the bridge is connected: cut every TCP connection like a network drop.
    liveSockets.forEach((socket) => socket.destroy());

    await waitFor(
      async () => {
        const sessions = await serverSessionsOf('mob2');
        return sessions.length === 1 && sessions[0] !== firstSession;
      },
      'the bridge to rejoin under a new session',
      12_000,
    );

    // The rejoined session is live in both directions.
    const peer = await joinWorld('peer2', TENANT_A.id);
    await waitFor(() => roster(peer).has('mob2'), 'the peer to see the rejoined bridge');
    bridge.send('move', { x: 41, y: 42, direction: 'up' });
    await waitFor(() => roster(peer).get('mob2')?.x === 41, 'the peer to see the rejoined bridge move');
    await waitFor(() => latestRoster(events)?.includes('peer2') === true, 'the bridge to see the peer');
  }, 20_000);
});
