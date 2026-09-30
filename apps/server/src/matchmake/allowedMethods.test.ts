/**
 * Method allow-list of the matchmake route: unit tests, plus a REAL Colyseus
 * server (see testUtils/matchmakeHarness.ts) proving that a refused method
 * builds no room and no PrismaClient, and that the one method clients use keeps
 * working. The transport guard is left out on purpose: the allow-list has to
 * hold on its own.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const createPrismaClientMock = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ createPrismaClient: createPrismaClientMock }));

import { ServerError } from '@colyseus/core';
import {
  disposeAllRooms,
  makeFakePrisma,
  matchmake,
  startMatchmakeServer,
  stopMatchmakeServer,
  worldRooms,
  type MatchmakeTestServer,
} from '../testUtils/matchmakeHarness.js';
import { ALLOWED_MATCHMAKE_METHODS, assertAllowedMatchmakeMethod } from './allowedMethods.js';
import { installPartitionKeyValidation, type TenantExists } from './tenantPartition.js';

describe('assertAllowedMatchmakeMethod', () => {
  it('lets joinOrCreate, the one method every client calls, through', () => {
    expect(ALLOWED_MATCHMAKE_METHODS).toEqual(['joinOrCreate']);
    expect(() => assertAllowedMatchmakeMethod('joinOrCreate')).not.toThrow();
  });

  it.each([
    'create',
    'join',
    'joinById',
    'reconnect',
    'joinorcreate',
    'JOINORCREATE',
    ' joinOrCreate',
    'joinOrCreate ',
    '',
    'constructor',
    '__proto__',
    'toString',
    'dispose',
  ])('refuses %j as a 400 invalid_method', (method) => {
    try {
      assertAllowedMatchmakeMethod(method);
      expect.unreachable('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(ServerError);
      expect(error).toMatchObject({ code: 400, message: 'invalid_method' });
    }
  });

  it.each([undefined, null, 7, {}, ['joinOrCreate']])('refuses the non-string %j', (method) => {
    expect(() => assertAllowedMatchmakeMethod(method)).toThrow(/invalid_method/);
  });
});

describe('the allow-list in front of Colyseus', () => {
  it('never reaches Colyseus, and looks no tenant up, for a method that is not allowed', async () => {
    const reached = vi.fn((..._args: unknown[]) => Promise.resolve({ room: { roomId: 'r1' } }));
    const controller = { invokeMethod: reached } as unknown as NonNullable<
      Parameters<typeof installPartitionKeyValidation>[1]
    >;
    const lookup = vi.fn<TenantExists>().mockResolvedValue(true);
    installPartitionKeyValidation(lookup, controller);
    await expect(controller.invokeMethod('create', 'world', { tenant: 'acme' }, {})).rejects.toMatchObject({
      code: 400,
      message: 'invalid_method',
    });
    expect(reached).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    await controller.invokeMethod('joinOrCreate', 'world', { tenant: 'acme' }, {});
    expect(reached).toHaveBeenCalledTimes(1);
  });
});

describe('matchmake methods against a real Colyseus server', () => {
  let server: MatchmakeTestServer;
  const tenantExists = vi.fn<TenantExists>((slug) => Promise.resolve(slug === 'acme'));

  beforeAll(async () => {
    createPrismaClientMock.mockImplementation(makeFakePrisma);
    server = await startMatchmakeServer({ guard: false, tenantExists });
  });

  afterAll(async () => {
    await stopMatchmakeServer(server);
  });

  beforeEach(async () => {
    await disposeAllRooms();
    createPrismaClientMock.mockClear();
    tenantExists.mockClear();
  });

  it.each([
    ['the default tenant', { tenant: 'default' }],
    ['no tenant', {}],
    ['an empty tenant', { tenant: '' }],
    ['an existing tenant', { tenant: 'acme' }],
  ])('builds no room for 10 anonymous create requests naming %s', async (_label, body) => {
    for (let i = 0; i < 10; i++) {
      const res = await matchmake(server, JSON.stringify(body), { path: '/matchmake/create/world' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ code: 400, error: 'invalid_method' });
    }
    expect(await worldRooms()).toHaveLength(0);
    expect(createPrismaClientMock).not.toHaveBeenCalled();
    expect(tenantExists).not.toHaveBeenCalled();
  });

  it.each(['create', 'join', 'joinById', 'reconnect'])('refuses %s without building a room', async (method) => {
    // For joinById and reconnect the room slot of the URL carries a room id.
    const slot = method === 'joinById' || method === 'reconnect' ? 'someRoomId' : 'world';
    const res = await matchmake(server, JSON.stringify({ tenant: 'default', reconnectionToken: 'x' }), {
      path: `/matchmake/${method}/${slot}`,
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 400, error: 'invalid_method' });
    expect(await worldRooms()).toHaveLength(0);
    expect(createPrismaClientMock).not.toHaveBeenCalled();
  });

  it('refuses an unknown method name the way it refuses a known one that is not allowed', async () => {
    const res = await matchmake(server, JSON.stringify({}), { path: '/matchmake/dispose/world' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_method');
  });

  it('keeps joinOrCreate working: a join builds its room, the next one joins it', async () => {
    const first = await matchmake(server, JSON.stringify({ tenant: 'acme' }));
    expect(first.status).toBe(200);
    expect(first.body.roomId).toBeTruthy();
    const again = await matchmake(server, JSON.stringify({ tenant: 'acme' }));
    expect(again.status).toBe(200);
    expect(await worldRooms()).toHaveLength(1);
  });

  it('keeps joinOrCreate working without a tenant and for the default tenant', async () => {
    expect((await matchmake(server, JSON.stringify({}))).status).toBe(200);
    expect((await matchmake(server, JSON.stringify({ tenant: 'default' }))).status).toBe(200);
  });
});
