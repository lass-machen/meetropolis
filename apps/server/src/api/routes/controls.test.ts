/**
 * Unit tests for the remote-control routes' restrictive-only hardening.
 * Both /controls and /controls/for/:identity are fan-out broadcast paths
 * that another authenticated user can trigger, so they must accept only
 * protective actions (disabling a device: `mic/cam/share === false`) and
 * reject every activating value plus `dnd` entirely. Force-mute
 * ({ mic: false }) must keep working.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { registerControlRoutes } from './controls.js';

type BroadcastCall = { event: string; data: unknown };

function makeApp(broadcastCalls: BroadcastCall[]): express.Application {
  const app = express();
  app.use(express.json());
  // Both endpoints only need an authenticated user; identity does not matter here.
  registerControlRoutes(
    app,
    () => ({ userId: 'user-real' }),
    () => Promise.resolve(null),
  );

  const fakeRoom = {
    broadcast: (event: string, data: unknown) => {
      broadcastCalls.push({ event, data });
    },
  };
  (global as unknown as { gameServer?: unknown }).gameServer = {};
  (global as unknown as { activeWorldRooms?: Set<unknown> }).activeWorldRooms = new Set([fakeRoom]);
  return app;
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
  it('accepts { mic: false } (force-mute) and broadcasts remote_controls', async () => {
    const app = makeApp(broadcastCalls);
    const res = await request(app).post('/controls').send({ mic: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(broadcastCalls).toHaveLength(1);
    expect(broadcastCalls[0]).toMatchObject({
      event: 'remote_controls',
      data: { from: 'user-real', payload: { mic: false } },
    });
  });

  it.each([{ cam: false }, { share: false }])('accepts protective %o', async (body) => {
    const app = makeApp(broadcastCalls);
    const res = await request(app).post('/controls').send(body);
    expect(res.status).toBe(200);
  });

  it.each([{ mic: true }, { cam: true }, { share: true }, { dnd: false }, { dnd: true }, {}])(
    'rejects %o with 400 and never broadcasts',
    async (body) => {
      const app = makeApp(broadcastCalls);
      const res = await request(app).post('/controls').send(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'invalid payload' });
      expect(broadcastCalls).toHaveLength(0);
    },
  );

  it('rejects a mixed payload that smuggles dnd alongside a valid mic:false', async () => {
    const app = makeApp(broadcastCalls);
    const res = await request(app).post('/controls').send({ mic: false, dnd: true });
    expect(res.status).toBe(400);
    expect(broadcastCalls).toHaveLength(0);
  });
});

describe('POST /controls/for/:identity: restrictive-only schema', () => {
  it('accepts { mic: false } and broadcasts remote_controls_for with the target identity', async () => {
    const app = makeApp(broadcastCalls);
    const res = await request(app).post('/controls/for/victim').send({ mic: false });

    expect(res.status).toBe(200);
    expect(broadcastCalls).toHaveLength(1);
    expect(broadcastCalls[0]).toMatchObject({
      event: 'remote_controls_for',
      data: { forIdentity: 'victim', from: 'user-real', payload: { mic: false } },
    });
  });

  it.each([{ mic: true }, { cam: true }, { share: true }, { dnd: false }, { dnd: true }, {}])(
    'rejects %o with 400 and never broadcasts',
    async (body) => {
      const app = makeApp(broadcastCalls);
      const res = await request(app).post('/controls/for/victim').send(body);
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
