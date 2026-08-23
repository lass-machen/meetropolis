/**
 * Unit tests for the remote-control routes.
 *
 * Two properties are covered here.
 *
 * 1. Restrictive-only payloads. Both /controls and /controls/for/:identity are
 *    fan-out broadcast paths that another authenticated user can trigger, so
 *    they must accept only protective actions (disabling a device:
 *    `mic/cam/share === false`) and reject every activating value plus `dnd`
 *    entirely. Force-mute ({ mic: false }) must keep working.
 * 2. Authorization, not merely authentication. Being logged in used to be the
 *    whole check: the routes then fanned out over every registered world room,
 *    so any user could mute any user of any tenant, and the untargeted variant
 *    silenced the entire deployment. A caller may now only reach rooms it is
 *    seated in, and a targeted mute additionally requires the target to be
 *    seated in the same room and visible to the caller under that room's
 *    tenant filter (one WorldRoom can hold several tenants, see
 *    rooms/lifecycle/tenantView.ts).
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { registerControlRoutes } from './controls.js';

type BroadcastCall = { event: string; data: unknown };

const CALLER = 'user-real';
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

type Seat = { identity: string; tenantKey?: string; isNpc?: boolean };

/**
 * A world room double shaped like the real one: `state.players` is keyed by
 * sessionId and carries the user id in `identity`, while the verified tenant of
 * each seat lives in the separate `playerTenantKey` map.
 */
function worldRoom(seats: Seat[], broadcastCalls: BroadcastCall[]) {
  const players = new Map<string, { identity: string; isNpc?: boolean }>();
  const playerTenantKey = new Map<string, string>();
  seats.forEach((seat, i) => {
    const sessionId = `s${i}`;
    players.set(sessionId, { identity: seat.identity, ...(seat.isNpc ? { isNpc: true } : {}) });
    if (seat.tenantKey !== undefined) playerTenantKey.set(sessionId, seat.tenantKey);
  });
  return {
    state: { players },
    playerTenantKey,
    broadcast: (event: string, data: unknown) => {
      broadcastCalls.push({ event, data });
    },
  };
}

function makeApp(): express.Application {
  const app = express();
  app.use(express.json());
  registerControlRoutes(
    app,
    () => ({ userId: CALLER }),
    () => Promise.resolve(null),
  );
  (global as unknown as { gameServer?: unknown }).gameServer = {};
  return app;
}

function setRooms(...rooms: unknown[]): void {
  (global as unknown as { activeWorldRooms?: Set<unknown> }).activeWorldRooms = new Set(rooms);
}

let broadcastCalls: BroadcastCall[];

beforeEach(() => {
  broadcastCalls = [];
});

afterEach(() => {
  delete (global as unknown as { gameServer?: unknown }).gameServer;
  delete (global as unknown as { activeWorldRooms?: unknown }).activeWorldRooms;
  vi.restoreAllMocks();
});

describe('POST /controls: restrictive-only schema', () => {
  beforeEach(() => {
    setRooms(worldRoom([{ identity: CALLER, tenantKey: TENANT_A }], broadcastCalls));
  });

  it('accepts { mic: false } (force-mute) and broadcasts remote_controls', async () => {
    const res = await request(makeApp()).post('/controls').send({ mic: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(broadcastCalls).toHaveLength(1);
    expect(broadcastCalls[0]).toMatchObject({
      event: 'remote_controls',
      data: { from: CALLER, payload: { mic: false } },
    });
  });

  it.each([{ cam: false }, { share: false }])('accepts protective %o', async (body) => {
    const res = await request(makeApp()).post('/controls').send(body);
    expect(res.status).toBe(200);
  });

  it.each([{ mic: true }, { cam: true }, { share: true }, { dnd: false }, { dnd: true }, {}])(
    'rejects %o with 400 and never broadcasts',
    async (body) => {
      const res = await request(makeApp()).post('/controls').send(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'invalid payload' });
      expect(broadcastCalls).toHaveLength(0);
    },
  );

  it('rejects a mixed payload that smuggles dnd alongside a valid mic:false', async () => {
    const res = await request(makeApp()).post('/controls').send({ mic: false, dnd: true });
    expect(res.status).toBe(400);
    expect(broadcastCalls).toHaveLength(0);
  });
});

describe('POST /controls/for/:identity: restrictive-only schema', () => {
  beforeEach(() => {
    setRooms(
      worldRoom(
        [
          { identity: CALLER, tenantKey: TENANT_A },
          { identity: 'victim', tenantKey: TENANT_A },
        ],
        broadcastCalls,
      ),
    );
  });

  it('accepts { mic: false } and broadcasts remote_controls_for with the target identity', async () => {
    const res = await request(makeApp()).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(200);
    expect(broadcastCalls).toHaveLength(1);
    expect(broadcastCalls[0]).toMatchObject({
      event: 'remote_controls_for',
      data: { forIdentity: 'victim', from: CALLER, payload: { mic: false } },
    });
  });

  it.each([{ mic: true }, { cam: true }, { share: true }, { dnd: false }, { dnd: true }, {}])(
    'rejects %o with 400 and never broadcasts',
    async (body) => {
      const res = await request(makeApp()).post('/controls/for/victim').send(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'invalid payload' });
      expect(broadcastCalls).toHaveLength(0);
    },
  );
});

describe('POST /controls: auth gate unchanged', () => {
  it('returns 401 when neither session nor API token authenticates', async () => {
    const app = express();
    app.use(express.json());
    registerControlRoutes(
      app,
      () => null,
      () => Promise.resolve(null),
    );
    const res = await request(app).post('/controls').send({ mic: false });
    expect(res.status).toBe(401);
  });
});

describe('authorization: a caller only reaches rooms it sits in', () => {
  it('refuses the untargeted broadcast when the caller sits in no world room', async () => {
    setRooms(worldRoom([{ identity: 'someone-else', tenantKey: TENANT_A }], broadcastCalls));

    const res = await request(makeApp()).post('/controls').send({ mic: false });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'caller_not_in_a_world_room' });
    expect(broadcastCalls).toHaveLength(0);
  });

  it('refuses when no world room is registered at all', async () => {
    setRooms();

    const res = await request(makeApp()).post('/controls').send({ mic: false });

    expect(res.status).toBe(403);
    expect(broadcastCalls).toHaveLength(0);
  });

  it('does not fan the untargeted broadcast out into rooms the caller is absent from', async () => {
    const mine = worldRoom([{ identity: CALLER, tenantKey: TENANT_A }], broadcastCalls);
    const foreign = worldRoom([{ identity: 'stranger', tenantKey: TENANT_B }], broadcastCalls);
    setRooms(mine, foreign);

    const res = await request(makeApp()).post('/controls').send({ mic: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ delivered: 1 });
    expect(broadcastCalls).toHaveLength(1);
  });
});

describe('authorization: a targeted mute needs a shared, tenant-visible seat', () => {
  it('refuses a target that sits in no room with the caller', async () => {
    setRooms(
      worldRoom([{ identity: CALLER, tenantKey: TENANT_A }], broadcastCalls),
      worldRoom([{ identity: 'victim', tenantKey: TENANT_A }], broadcastCalls),
    );

    const res = await request(makeApp()).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'target_not_reachable' });
    expect(broadcastCalls).toHaveLength(0);
  });

  it('refuses a target of another tenant that shares the apex room', async () => {
    // The realistic cross-tenant case: one WorldRoom, two tenants, separated
    // only by the per-client StateView filter. The caller cannot even see this
    // player, so it must not be able to mute it either.
    setRooms(
      worldRoom(
        [
          { identity: CALLER, tenantKey: TENANT_A },
          { identity: 'victim', tenantKey: TENANT_B },
        ],
        broadcastCalls,
      ),
    );

    const res = await request(makeApp()).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'target_not_reachable' });
    expect(broadcastCalls).toHaveLength(0);
  });

  it('refuses a target whose tenant key is unknown (fails closed)', async () => {
    setRooms(worldRoom([{ identity: CALLER, tenantKey: TENANT_A }, { identity: 'victim' }], broadcastCalls));

    const res = await request(makeApp()).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(403);
    expect(broadcastCalls).toHaveLength(0);
  });

  it('refuses when the caller itself has no tenant key (fails closed)', async () => {
    setRooms(worldRoom([{ identity: CALLER }, { identity: 'victim', tenantKey: TENANT_A }], broadcastCalls));

    const res = await request(makeApp()).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(403);
    expect(broadcastCalls).toHaveLength(0);
  });

  it('reaches only the shared room when the caller sits in several', async () => {
    const shared = worldRoom(
      [
        { identity: CALLER, tenantKey: TENANT_A },
        { identity: 'victim', tenantKey: TENANT_A },
      ],
      broadcastCalls,
    );
    const other = worldRoom([{ identity: CALLER, tenantKey: TENANT_A }], broadcastCalls);
    setRooms(shared, other);

    const res = await request(makeApp()).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ delivered: 1 });
    expect(broadcastCalls).toHaveLength(1);
  });
});
