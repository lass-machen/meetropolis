/**
 * Admin system view in multi-process mode: with `REDIS_URL` set the room
 * list and the websocket probe read the shared registry through
 * `matchMaker.query({})` first, because the process-local
 * `global.activeWorldRooms` set cannot see other processes' rooms.
 * Without `REDIS_URL` the order stays exactly as before (local set first).
 *
 * The tests drive the exported route handlers (`handleDebugRooms` for
 * `loadRoomList`, `handleAdminHealth` for `probeWebsocket`) with a stubbed
 * super-admin check, so no database is needed. `gameServer.matchMaker` is a
 * plain object with a `query` stub: the registry client is a system
 * boundary here, and the unit test only pins which source wins, not the
 * Colyseus client itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type express from 'express';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const requireSuperAdminMock = vi.hoisted(() => vi.fn());
const computeOnlineUsageMock = vi.hoisted(() => vi.fn());
vi.mock('../utils/authHelpers.js', () => ({
  requireSuperAdmin: (...args: unknown[]) => requireSuperAdminMock(...args),
  computeOnlineUsageByTenantSlug: (...args: unknown[]) => computeOnlineUsageMock(...args),
}));

import { handleAdminHealth, handleDebugRooms } from './admin.system.js';
import type { PrismaClient } from '../../generated/prisma/index.js';
import type { WorldRoom } from '../../rooms/WorldRoom.js';

const REDIS_URL = 'redis://localhost:6379';
const ORIGINAL_ENV = { ...process.env };
const originalGameServer = global.gameServer;
const originalActiveWorldRooms = global.activeWorldRooms;

function fakeRes(): express.Response {
  const res = {} as express.Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function jsonBody(res: express.Response): Record<string, unknown> {
  return (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
}

function fakePrisma(): PrismaClient {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]),
    user: { count: vi.fn().mockResolvedValue(0) },
    tenant: { count: vi.fn().mockResolvedValue(0) },
    session: { count: vi.fn().mockResolvedValue(0) },
    membership: { count: vi.fn().mockResolvedValue(0) },
  } as unknown as PrismaClient;
}

/** A room as seen through the process-local set. */
function localRoom() {
  return {
    roomId: 'local-room',
    roomName: 'world',
    clients: { size: 4 },
    locked: false,
    maxClients: 50,
    metadata: {},
  } as unknown as WorldRoom;
}

/** A room entry as returned by the shared `matchMaker.query` registry. */
function sharedRoom(roomId: string, clients: number | { size: number }) {
  return { roomId, roomName: 'world', clients, locked: false, maxClients: 50, metadata: {} };
}

beforeEach(() => {
  requireSuperAdminMock.mockReset().mockResolvedValue({ userId: 'admin' });
  computeOnlineUsageMock.mockReset().mockReturnValue({});
  delete process.env.REDIS_URL;
  (global as { activeWorldRooms?: unknown }).activeWorldRooms = new Set([localRoom()]);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  global.gameServer = originalGameServer;
  global.activeWorldRooms = originalActiveWorldRooms;
  vi.restoreAllMocks();
});

describe('handleDebugRooms room source', () => {
  it('prefers the shared registry when REDIS_URL is set', async () => {
    process.env.REDIS_URL = REDIS_URL;
    const query = vi.fn().mockResolvedValue([sharedRoom('shared-room', 7)]);
    (global as { gameServer?: unknown }).gameServer = { matchMaker: { query } };

    const res = fakeRes();
    await handleDebugRooms(fakePrisma(), {} as express.Request, res);

    expect(query).toHaveBeenCalledWith({});
    const body = jsonBody(res) as { rooms: Array<{ roomId?: string }> };
    expect(body.rooms.map((r) => r.roomId)).toEqual(['shared-room']);
  });

  it('keeps the local list first without REDIS_URL', async () => {
    const query = vi.fn().mockResolvedValue([sharedRoom('shared-room', 7)]);
    (global as { gameServer?: unknown }).gameServer = { matchMaker: { query } };

    const res = fakeRes();
    await handleDebugRooms(fakePrisma(), {} as express.Request, res);

    expect(query).not.toHaveBeenCalled();
    const body = jsonBody(res) as { rooms: Array<{ roomId?: string }> };
    expect(body.rooms.map((r) => r.roomId)).toEqual(['local-room']);
  });
});

describe('handleAdminHealth websocket probe', () => {
  it('counts shared rooms when REDIS_URL is set', async () => {
    process.env.REDIS_URL = REDIS_URL;
    const query = vi.fn().mockResolvedValue([sharedRoom('a', 3), sharedRoom('b', { size: 2 })]);
    (global as { gameServer?: unknown }).gameServer = { matchMaker: { query } };

    const res = fakeRes();
    await handleAdminHealth(fakePrisma(), {} as express.Request, res);

    expect(query).toHaveBeenCalledWith({});
    const websocket = jsonBody(res).websocket as { activeRooms: number; activeConnections: number };
    expect(websocket).toMatchObject({ status: 'ok', activeRooms: 2, activeConnections: 5 });
  });

  it('counts local rooms without REDIS_URL', async () => {
    const query = vi.fn().mockResolvedValue([sharedRoom('a', 3), sharedRoom('b', { size: 2 })]);
    (global as { gameServer?: unknown }).gameServer = { matchMaker: { query } };

    const res = fakeRes();
    await handleAdminHealth(fakePrisma(), {} as express.Request, res);

    expect(query).not.toHaveBeenCalled();
    const websocket = jsonBody(res).websocket as { activeRooms: number; activeConnections: number };
    expect(websocket).toMatchObject({ status: 'ok', activeRooms: 1, activeConnections: 4 });
  });
});
