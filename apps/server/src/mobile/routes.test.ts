import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { MIN_ZONE_PRIVACY_CLIENT_VERSION } from '@meetropolis/shared';

/**
 * Route-level guards only: authentication, input validation and session
 * ownership. The world bridge is stubbed out — whether Colyseus accepts the
 * join is covered by the room's own auth tests.
 */

let authResult: { userId: string; tenantId?: string } | null = { userId: 'user-1' };
vi.mock('../api/utils/authHelpers.js', () => ({
  requireAuth: () => authResult,
}));

vi.mock('../api/middleware/rateLimit.js', () => ({
  mobileStreamRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  mobileActionRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const started: Array<{ sessionId: string; userId: string; zonePrivacyVersion: number; tenantSlug?: string }> = [];
const handledActions: Array<{ type: string }> = [];

vi.mock('./mobileSession.js', () => ({
  MobileSession: class {
    sessionId: string;
    userId: string;
    constructor(options: { sessionId: string; userId: string; zonePrivacyVersion: number; tenantSlug?: string }) {
      this.sessionId = options.sessionId;
      this.userId = options.userId;
      started.push(options);
    }
    async start() {}
    handleAction(action: { type: string }) {
      handledActions.push(action);
    }
    async close() {}
  },
}));

const { registerMobileRoutes } = await import('./routes.js');
const { closeAllSessions, getSession } = await import('./sessionRegistry.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  registerMobileRoutes(app);
  return app;
}

const validStream = `/mobile/stream?zonePrivacyVersion=${MIN_ZONE_PRIVACY_CLIENT_VERSION}`;

beforeEach(async () => {
  await closeAllSessions();
  started.length = 0;
  handledActions.length = 0;
  authResult = { userId: 'user-1' };
});

describe('GET /mobile/stream', () => {
  it('rejects an unauthenticated request', async () => {
    authResult = null;
    await request(makeApp()).get(validStream).expect(401);
  });

  it('rejects a request without the raw bearer token', async () => {
    // requireAuth may pass on a cookie session, but the world room join needs
    // the raw token and we will not mint a fresh one here.
    await request(makeApp()).get(validStream).expect(400, { error: 'missing_bearer_token' });
  });

  it('rejects a missing zone-privacy version', async () => {
    await request(makeApp()).get('/mobile/stream').set('Authorization', 'Bearer jwt').expect(400);
  });

  it('rejects a zone-privacy version below the minimum', async () => {
    // Mirrors the authoritative gate in rooms/lifecycle/onAuth.ts: a client
    // that does not implement the current zone-privacy contract must not get
    // in, because the boundary is enforced client-side at the SFU.
    const stale = MIN_ZONE_PRIVACY_CLIENT_VERSION - 1;
    await request(makeApp())
      .get(`/mobile/stream?zonePrivacyVersion=${stale}`)
      .set('Authorization', 'Bearer jwt')
      .expect(400, { error: 'invalid_query' });
  });

  it('passes the tenant and the claimed version through to the session', async () => {
    const app = makeApp();
    // The stream never ends on its own, so abort once the headers are in.
    await new Promise<void>((resolve) => {
      const req = request(app)
        .get(`${validStream}&tenant=acme`)
        .set('Authorization', 'Bearer jwt')
        .end(() => resolve());
      setTimeout(() => {
        req.abort();
        resolve();
      }, 50);
    });

    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      userId: 'user-1',
      tenantSlug: 'acme',
      zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION,
    });
  });
});

describe('POST /mobile/action', () => {
  it('rejects an unauthenticated request', async () => {
    authResult = null;
    await request(makeApp())
      .post('/mobile/action')
      .send({ sessionId: '00000000-0000-4000-8000-000000000000', action: { type: 'heartbeat' } })
      .expect(401);
  });

  it('rejects a malformed body', async () => {
    await request(makeApp()).post('/mobile/action').send({ nope: true }).expect(400, { error: 'invalid_action' });
  });

  it('rejects an action type the mini mode must not send', async () => {
    // Editor updates, NPC commands and remote control stay out of the mobile
    // surface on purpose.
    await request(makeApp())
      .post('/mobile/action')
      .send({ sessionId: '00000000-0000-4000-8000-000000000000', action: { type: 'editor_update' } })
      .expect(400);
  });

  it('answers 404 for a session the caller does not own', async () => {
    const { MobileSession } = await import('./mobileSession.js');
    const { registerSession } = await import('./sessionRegistry.js');
    const foreign = new MobileSession({
      sessionId: '11111111-1111-4111-8111-111111111111',
      userId: 'someone-else',
    } as never);
    registerSession(foreign);

    await request(makeApp())
      .post('/mobile/action')
      .send({ sessionId: '11111111-1111-4111-8111-111111111111', action: { type: 'heartbeat' } })
      .expect(404, { error: 'session_not_found' });
    expect(handledActions).toHaveLength(0);
  });

  it('forwards a valid action to the owning session', async () => {
    const { MobileSession } = await import('./mobileSession.js');
    const { registerSession } = await import('./sessionRegistry.js');
    const own = new MobileSession({
      sessionId: '22222222-2222-4222-8222-222222222222',
      userId: 'user-1',
    } as never);
    registerSession(own);
    expect(getSession('22222222-2222-4222-8222-222222222222')).toBeDefined();

    await request(makeApp())
      .post('/mobile/action')
      .send({ sessionId: '22222222-2222-4222-8222-222222222222', action: { type: 'dnd', dnd: true } })
      .expect(204);

    expect(handledActions).toEqual([{ type: 'dnd', dnd: true }]);
  });
});
