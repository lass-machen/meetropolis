/**
 * Unit tests for the remote-control routes.
 *
 * Three properties are covered here.
 *
 * 1. Restrictive-only payloads. Both /controls and /controls/for/:identity are
 *    fan-out paths that another authenticated user can trigger, so they must
 *    accept only protective actions (disabling a device:
 *    `mic/cam/share === false`) and reject every activating value plus `dnd`
 *    entirely. Force-mute ({ mic: false }) must keep working.
 * 2. Authorization, not merely authentication. Being logged in used to be the
 *    whole check: the routes then fanned out over every registered world room,
 *    so any user could mute any user of any tenant, and the untargeted variant
 *    silenced the entire deployment. /controls now reaches the caller's OWN
 *    sessions and nothing else, and a targeted mute requires the target to be
 *    seated in a room with the caller and visible to it under that room's
 *    tenant filter (one WorldRoom can hold several tenants, see
 *    rooms/lifecycle/tenantView.ts). Which tenant the caller acts under is
 *    decided by the tenant the REQUEST authenticated with, never by whichever
 *    of its seats is iterated first.
 * 3. Delivery, not just authorization. Authorizing a room and then calling
 *    `room.broadcast` would hand the message to every client of the instance,
 *    which crosses the very boundary point 2 draws. The assertions below are
 *    therefore on the RECIPIENT LIST, never on a broadcast count: the room
 *    double has no `broadcast` at all, so a regression to a room-wide send
 *    fails instead of passing silently.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { registerControlRoutes } from './controls.js';

/** One message as it arrived at one client. */
type SendCall = { sessionId: string; event: string; data: unknown };

const CALLER = 'user-real';
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

type Seat = { identity: string; tenantKey?: string; isNpc?: boolean; offline?: boolean };

/**
 * A world room double shaped like the real one: `state.players` is keyed by
 * sessionId and carries the user id in `identity`, the verified tenant of each
 * seat lives in the separate `playerTenantKey` map, and `clients` holds the
 * connected clients that a per-client send addresses. Seats are numbered per
 * room (`r<roomIndex>s<seatIndex>`) so a recipient list stays readable across
 * several rooms. A seat marked `offline` gets no client, which is how a player
 * that is still in the state but already disconnected looks.
 */
function worldRoom(roomIndex: number, seats: Seat[], sendCalls: SendCall[]) {
  const players = new Map<string, { identity: string; isNpc?: boolean }>();
  const playerTenantKey = new Map<string, string>();
  const clients: Array<{ sessionId: string; send: (event: string, data: unknown) => void }> = [];
  seats.forEach((seat, i) => {
    const sessionId = `r${roomIndex}s${i}`;
    players.set(sessionId, { identity: seat.identity, ...(seat.isNpc ? { isNpc: true } : {}) });
    if (seat.tenantKey !== undefined) playerTenantKey.set(sessionId, seat.tenantKey);
    if (!seat.offline) {
      clients.push({
        sessionId,
        send: (event: string, data: unknown) => {
          sendCalls.push({ sessionId, event, data });
        },
      });
    }
  });
  return { state: { players }, playerTenantKey, clients };
}

/**
 * The app under test. By default the caller authenticates with a session that
 * carries no tenant claim. `sessionTenantId` gives that session a verified
 * tenant; `apiToken: true` swaps the session for an API token, which resolves a
 * user but never a tenant (see api/utils/authHelpers.ts requireApiToken).
 */
function makeApp(opts: { sessionTenantId?: string; apiToken?: boolean } = {}): express.Application {
  const app = express();
  app.use(express.json());
  const session = opts.apiToken
    ? null
    : { userId: CALLER, ...(opts.sessionTenantId ? { tenantId: opts.sessionTenantId } : {}) };
  registerControlRoutes(
    app,
    () => session,
    () => Promise.resolve(opts.apiToken ? { userId: CALLER } : null),
  );
  (global as unknown as { gameServer?: unknown }).gameServer = {};
  return app;
}

function setRooms(...rooms: unknown[]): void {
  (global as unknown as { activeWorldRooms?: Set<unknown> }).activeWorldRooms = new Set(rooms);
}

/** The sessionIds that received something, in delivery order. */
function recipients(sendCalls: SendCall[]): string[] {
  return sendCalls.map((c) => c.sessionId);
}

let sendCalls: SendCall[];

beforeEach(() => {
  sendCalls = [];
});

afterEach(() => {
  delete (global as unknown as { gameServer?: unknown }).gameServer;
  delete (global as unknown as { activeWorldRooms?: unknown }).activeWorldRooms;
  vi.restoreAllMocks();
});

describe('POST /controls: restrictive-only schema', () => {
  beforeEach(() => {
    setRooms(worldRoom(0, [{ identity: CALLER, tenantKey: TENANT_A }], sendCalls));
  });

  it('accepts { mic: false } (force-mute) and sends remote_controls', async () => {
    const res = await request(makeApp()).post('/controls').send({ mic: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]).toMatchObject({
      event: 'remote_controls',
      data: { from: CALLER, payload: { mic: false } },
    });
  });

  it.each([{ cam: false }, { share: false }])('accepts protective %o', async (body) => {
    const res = await request(makeApp()).post('/controls').send(body);
    expect(res.status).toBe(200);
  });

  it.each([{ mic: true }, { cam: true }, { share: true }, { dnd: false }, { dnd: true }, {}])(
    'rejects %o with 400 and never sends',
    async (body) => {
      const res = await request(makeApp()).post('/controls').send(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'invalid payload' });
      expect(sendCalls).toHaveLength(0);
    },
  );

  it('rejects a mixed payload that smuggles dnd alongside a valid mic:false', async () => {
    const res = await request(makeApp()).post('/controls').send({ mic: false, dnd: true });
    expect(res.status).toBe(400);
    expect(sendCalls).toHaveLength(0);
  });
});

describe('POST /controls/for/:identity: restrictive-only schema', () => {
  beforeEach(() => {
    setRooms(
      worldRoom(
        0,
        [
          { identity: CALLER, tenantKey: TENANT_A },
          { identity: 'victim', tenantKey: TENANT_A },
        ],
        sendCalls,
      ),
    );
  });

  it('accepts { mic: false } and sends remote_controls_for with the target identity', async () => {
    const res = await request(makeApp()).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(200);
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]).toMatchObject({
      event: 'remote_controls_for',
      data: { forIdentity: 'victim', from: CALLER, payload: { mic: false } },
    });
  });

  it.each([{ mic: true }, { cam: true }, { share: true }, { dnd: false }, { dnd: true }, {}])(
    'rejects %o with 400 and never sends',
    async (body) => {
      const res = await request(makeApp()).post('/controls/for/victim').send(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'invalid payload' });
      expect(sendCalls).toHaveLength(0);
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

describe('POST /controls: the untargeted route reaches the caller and nobody else', () => {
  it('refuses when the caller sits in no world room', async () => {
    setRooms(worldRoom(0, [{ identity: 'someone-else', tenantKey: TENANT_A }], sendCalls));

    const res = await request(makeApp()).post('/controls').send({ mic: false });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'caller_not_in_a_world_room' });
    expect(sendCalls).toHaveLength(0);
  });

  it('refuses when no world room is registered at all', async () => {
    setRooms();

    const res = await request(makeApp()).post('/controls').send({ mic: false });

    expect(res.status).toBe(403);
    expect(sendCalls).toHaveLength(0);
  });

  it('does not reach a same-tenant peer sharing the room', async () => {
    // The route steers the caller's own devices. A peer of the same tenant is
    // still somebody else's device and needs /controls/for/:identity.
    setRooms(
      worldRoom(
        0,
        [
          { identity: CALLER, tenantKey: TENANT_A },
          { identity: 'peer', tenantKey: TENANT_A },
        ],
        sendCalls,
      ),
    );

    const res = await request(makeApp()).post('/controls').send({ mic: false });

    expect(res.status).toBe(200);
    expect(recipients(sendCalls)).toEqual(['r0s0']);
    expect(res.body).toMatchObject({ delivered: 1 });
  });

  it('does not reach a foreign tenant in the shared apex room', async () => {
    setRooms(
      worldRoom(
        0,
        [
          { identity: CALLER, tenantKey: TENANT_A },
          { identity: 'foreign', tenantKey: TENANT_B },
        ],
        sendCalls,
      ),
    );

    const res = await request(makeApp()).post('/controls').send({ mic: false });

    expect(res.status).toBe(200);
    expect(recipients(sendCalls)).toEqual(['r0s0']);
  });

  it('does not fan out into rooms the caller is absent from', async () => {
    const mine = worldRoom(0, [{ identity: CALLER, tenantKey: TENANT_A }], sendCalls);
    const foreign = worldRoom(1, [{ identity: 'stranger', tenantKey: TENANT_A }], sendCalls);
    setRooms(mine, foreign);

    const res = await request(makeApp()).post('/controls').send({ mic: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ delivered: 1 });
    expect(recipients(sendCalls)).toEqual(['r0s0']);
  });

  it('reaches every session of the caller, in every room it sits in', async () => {
    setRooms(
      worldRoom(
        0,
        [
          { identity: CALLER, tenantKey: TENANT_A },
          { identity: 'peer', tenantKey: TENANT_A },
          { identity: CALLER, tenantKey: TENANT_A },
        ],
        sendCalls,
      ),
      worldRoom(1, [{ identity: CALLER, tenantKey: TENANT_A }], sendCalls),
    );

    const res = await request(makeApp()).post('/controls').send({ mic: false });

    expect(res.status).toBe(200);
    expect(recipients(sendCalls)).toEqual(['r0s0', 'r0s2', 'r1s0']);
    expect(res.body).toMatchObject({ delivered: 3 });
  });

  it("reaches the caller's own session even when its seat carries no verified tenant", async () => {
    // Own device, own id: there is no tenant boundary between the caller and
    // itself, so nothing here has to fail closed on a missing key.
    setRooms(worldRoom(0, [{ identity: CALLER }, { identity: 'other', tenantKey: TENANT_A }], sendCalls));

    const res = await request(makeApp()).post('/controls').send({ mic: false });

    expect(res.status).toBe(200);
    expect(recipients(sendCalls)).toEqual(['r0s0']);
  });

  it("reaches the caller's second session under another verified tenant", async () => {
    // Same user, two tenants, one apex room. Both devices are the caller's own.
    setRooms(
      worldRoom(
        0,
        [
          { identity: CALLER, tenantKey: TENANT_A },
          { identity: CALLER, tenantKey: TENANT_B },
        ],
        sendCalls,
      ),
    );

    const res = await request(makeApp({ sessionTenantId: TENANT_A }))
      .post('/controls')
      .send({ mic: false });

    expect(res.status).toBe(200);
    expect(recipients(sendCalls)).toEqual(['r0s0', 'r0s1']);
  });

  it("skips an NPC seat that carries the caller's identity", async () => {
    setRooms(
      worldRoom(
        0,
        [
          { identity: CALLER, tenantKey: TENANT_A },
          { identity: CALLER, tenantKey: '__no_tenant__', isNpc: true },
        ],
        sendCalls,
      ),
    );

    const res = await request(makeApp()).post('/controls').send({ mic: false });

    expect(res.status).toBe(200);
    expect(recipients(sendCalls)).toEqual(['r0s0']);
  });

  it('answers 409 when the caller is the only seat and already disconnected', async () => {
    setRooms(worldRoom(0, [{ identity: CALLER, tenantKey: TENANT_A, offline: true }], sendCalls));

    const res = await request(makeApp()).post('/controls').send({ mic: false });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'no_active_targets' });
    expect(sendCalls).toHaveLength(0);
  });
});

describe('authorization: a targeted mute needs a shared, tenant-visible seat', () => {
  it('refuses a target that sits in no room with the caller', async () => {
    setRooms(
      worldRoom(0, [{ identity: CALLER, tenantKey: TENANT_A }], sendCalls),
      worldRoom(1, [{ identity: 'victim', tenantKey: TENANT_A }], sendCalls),
    );

    const res = await request(makeApp()).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'target_not_reachable' });
    expect(sendCalls).toHaveLength(0);
  });

  it('refuses a target of another tenant that shares the apex room', async () => {
    setRooms(
      worldRoom(
        0,
        [
          { identity: CALLER, tenantKey: TENANT_A },
          { identity: 'victim', tenantKey: TENANT_B },
        ],
        sendCalls,
      ),
    );

    const res = await request(makeApp()).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'target_not_reachable' });
    expect(sendCalls).toHaveLength(0);
  });

  it('refuses a target whose tenant key is unknown (fails closed)', async () => {
    setRooms(worldRoom(0, [{ identity: CALLER, tenantKey: TENANT_A }, { identity: 'victim' }], sendCalls));

    const res = await request(makeApp()).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(403);
    expect(sendCalls).toHaveLength(0);
  });

  it('refuses when the caller itself has no tenant key (fails closed)', async () => {
    setRooms(worldRoom(0, [{ identity: CALLER }, { identity: 'victim', tenantKey: TENANT_A }], sendCalls));

    const res = await request(makeApp()).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(403);
    expect(sendCalls).toHaveLength(0);
  });

  it('reaches the target through an API token as well', async () => {
    setRooms(
      worldRoom(
        0,
        [
          { identity: CALLER, tenantKey: TENANT_A },
          { identity: 'victim', tenantKey: TENANT_A },
        ],
        sendCalls,
      ),
    );

    const res = await request(makeApp({ apiToken: true }))
      .post('/controls/for/victim')
      .send({ mic: false });

    expect(res.status).toBe(200);
    expect(recipients(sendCalls)).toEqual(['r0s1']);
  });

  it('reaches only the shared room when the caller sits in several', async () => {
    const shared = worldRoom(
      0,
      [
        { identity: CALLER, tenantKey: TENANT_A },
        { identity: 'victim', tenantKey: TENANT_A },
      ],
      sendCalls,
    );
    const other = worldRoom(1, [{ identity: CALLER, tenantKey: TENANT_A }], sendCalls);
    setRooms(shared, other);

    const res = await request(makeApp()).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ delivered: 1 });
    expect(recipients(sendCalls)).toEqual(['r0s1']);
  });
});

describe('delivery: a targeted mute reaches the target and nobody else', () => {
  it('does not tell a foreign tenant who muted whom', async () => {
    // The payload carries two user ids (target and caller). A room-wide
    // broadcast would hand both to tenant B, which the StateView filter
    // otherwise withholds.
    setRooms(
      worldRoom(
        0,
        [
          { identity: CALLER, tenantKey: TENANT_A },
          { identity: 'victim', tenantKey: TENANT_A },
          { identity: 'foreign', tenantKey: TENANT_B },
        ],
        sendCalls,
      ),
    );

    const res = await request(makeApp()).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(200);
    expect(recipients(sendCalls)).toEqual(['r0s1']);
    expect(sendCalls[0]?.data).toMatchObject({ forIdentity: 'victim', from: CALLER });
  });

  it('addresses only the target sessions that passed the tenant check', async () => {
    // Same user, two sessions, different verified tenants in one apex room.
    // The client-side filter matches on forIdentity alone, so the session that
    // was never authorized must not receive the message at all.
    setRooms(
      worldRoom(
        0,
        [
          { identity: CALLER, tenantKey: TENANT_A },
          { identity: 'victim', tenantKey: TENANT_A },
          { identity: 'victim', tenantKey: TENANT_B },
        ],
        sendCalls,
      ),
    );

    const res = await request(makeApp()).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(200);
    expect(recipients(sendCalls)).toEqual(['r0s1']);
    expect(res.body).toMatchObject({ delivered: 1 });
  });

  it('reaches both sessions of a target that is connected twice in its own tenant', async () => {
    setRooms(
      worldRoom(
        0,
        [
          { identity: CALLER, tenantKey: TENANT_A },
          { identity: 'victim', tenantKey: TENANT_A },
          { identity: 'victim', tenantKey: TENANT_A },
        ],
        sendCalls,
      ),
    );

    const res = await request(makeApp()).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(200);
    expect(recipients(sendCalls)).toEqual(['r0s1', 'r0s2']);
    expect(res.body).toMatchObject({ delivered: 2 });
  });

  it('answers 409 when the authorized target has no connected client left', async () => {
    setRooms(
      worldRoom(
        0,
        [
          { identity: CALLER, tenantKey: TENANT_A },
          { identity: 'victim', tenantKey: TENANT_A, offline: true },
        ],
        sendCalls,
      ),
    );

    const res = await request(makeApp()).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'no_active_targets' });
    expect(sendCalls).toHaveLength(0);
  });
});

describe("authorization: the caller's tenant comes from the request, not from a seat", () => {
  /**
   * One user, two verified tenants, one shared apex room. Seat r0s0 is the
   * caller under tenant A, r0s1 the same caller under tenant B, r0s2 the
   * target under tenant B. Which of the caller's two seats decides used to be
   * whatever the state map iterated first — here that is tenant A, which
   * cannot see the target at all.
   */
  function apexRoomWithTwoCallerTenants() {
    setRooms(
      worldRoom(
        0,
        [
          { identity: CALLER, tenantKey: TENANT_A },
          { identity: CALLER, tenantKey: TENANT_B },
          { identity: 'victim', tenantKey: TENANT_B },
        ],
        sendCalls,
      ),
    );
  }

  it('acts under the tenant the request authenticated with', async () => {
    apexRoomWithTwoCallerTenants();

    const res = await request(makeApp({ sessionTenantId: TENANT_B }))
      .post('/controls/for/victim')
      .send({ mic: false });

    expect(res.status).toBe(200);
    expect(recipients(sendCalls)).toEqual(['r0s2']);
  });

  it('does not let a seat under another tenant widen the reach of the request', async () => {
    apexRoomWithTwoCallerTenants();

    const res = await request(makeApp({ sessionTenantId: TENANT_A }))
      .post('/controls/for/victim')
      .send({ mic: false });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'target_not_reachable' });
    expect(sendCalls).toHaveLength(0);
  });

  it('refuses when no seat of the caller carries the tenant of the request (fails closed)', async () => {
    setRooms(
      worldRoom(
        0,
        [
          { identity: CALLER, tenantKey: TENANT_A },
          { identity: 'victim', tenantKey: TENANT_A },
        ],
        sendCalls,
      ),
    );

    const res = await request(makeApp({ sessionTenantId: TENANT_B }))
      .post('/controls/for/victim')
      .send({ mic: false });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'caller_tenant_unknown' });
    expect(sendCalls).toHaveLength(0);
  });

  it('refuses an API token whose caller sits under two tenants at once (fails closed)', async () => {
    // A token resolves a user, never a tenant, so only the seats can answer —
    // and two different answers are no answer.
    apexRoomWithTwoCallerTenants();

    const res = await request(makeApp({ apiToken: true }))
      .post('/controls/for/victim')
      .send({ mic: false });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'caller_tenant_unknown' });
    expect(sendCalls).toHaveLength(0);
  });
});
