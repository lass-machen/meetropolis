import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { MIN_ZONE_PRIVACY_CLIENT_VERSION } from '@meetropolis/shared';

/**
 * Route-level guards only: authentication, input validation and session
 * ownership. The world bridge is stubbed out — whether Colyseus accepts the
 * join is covered by the room's own auth tests.
 */

let authResult: { userId: string; tenantId?: string } | null = { userId: 'user-1' };
let resolvedTenant: { id: string; slug: string; name: string } | null = {
  id: 'tenant-1',
  slug: 'acme',
  name: 'Acme',
};
vi.mock('../api/utils/authHelpers.js', () => ({
  requireAuth: () => authResult,
  // Stands in for `tenantMiddleware`, which resolves `req.tenant` before the
  // route table in the real app.
  getTenantFromReq: () => resolvedTenant,
}));

vi.mock('../api/middleware/rateLimit.js', () => ({
  mobileStreamRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  mobileActionRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const started: Array<{ sessionId: string; userId: string; zonePrivacyVersion: number; tenantSlug?: string }> = [];
const handledActions: Array<{ type: string }> = [];
const reportedFailures: string[] = [];
let worldJoinFails = false;

vi.mock('./mobileSession.js', () => ({
  MobileSession: class {
    sessionId: string;
    userId: string;
    constructor(options: { sessionId: string; userId: string; zonePrivacyVersion: number; tenantSlug?: string }) {
      this.sessionId = options.sessionId;
      this.userId = options.userId;
      started.push(options);
    }
    start() {
      return worldJoinFails ? Promise.reject(new Error('world join failed')) : Promise.resolve();
    }
    emitFailure(reason: string) {
      reportedFailures.push(reason);
    }
    handleAction(action: { type: string }) {
      handledActions.push(action);
    }
    async close() {}
  },
}));

const { registerMobileRoutes } = await import('./routes.js');
const { closeAllSessions, getSession } = await import('./sessionRegistry.js');
const { MOBILE_PROTOCOL_VERSION } = await import('./protocol.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  registerMobileRoutes(app);
  return app;
}

const validStream =
  `/mobile/stream?zonePrivacyVersion=${MIN_ZONE_PRIVACY_CLIENT_VERSION}` +
  `&protocolVersion=${MOBILE_PROTOCOL_VERSION}`;

/** Opens the stream and returns once the headers are in; it never ends on its own. */
async function openStream(app: express.Express, path: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = request(app)
      .get(path)
      .set('Authorization', 'Bearer jwt')
      .end(() => resolve());
    setTimeout(() => {
      req.abort();
      resolve();
    }, 50);
  });
}

const originalMobileGatewayEnabled = process.env.MOBILE_GATEWAY_ENABLED;

beforeEach(async () => {
  await closeAllSessions();
  started.length = 0;
  handledActions.length = 0;
  authResult = { userId: 'user-1' };
  resolvedTenant = { id: 'tenant-1', slug: 'acme', name: 'Acme' };
  reportedFailures.length = 0;
  worldJoinFails = false;
  // Every existing test below assumes the routes are registered; the gate
  // itself gets its own describe block further down.
  process.env.MOBILE_GATEWAY_ENABLED = 'true';
});

afterEach(() => {
  if (originalMobileGatewayEnabled === undefined) delete process.env.MOBILE_GATEWAY_ENABLED;
  else process.env.MOBILE_GATEWAY_ENABLED = originalMobileGatewayEnabled;
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
    await request(makeApp())
      .get(`/mobile/stream?protocolVersion=${MOBILE_PROTOCOL_VERSION}`)
      .set('Authorization', 'Bearer jwt')
      .expect(400);
  });

  it('rejects a missing protocol version', async () => {
    // Without it the server cannot tell whether the app speaks the contract
    // it is about to be served.
    await request(makeApp())
      .get(`/mobile/stream?zonePrivacyVersion=${MIN_ZONE_PRIVACY_CLIENT_VERSION}`)
      .set('Authorization', 'Bearer jwt')
      .expect(400, { error: 'invalid_query' });
  });

  it('answers 426 for a protocol version it cannot serve', async () => {
    await request(makeApp())
      .get(
        `/mobile/stream?zonePrivacyVersion=${MIN_ZONE_PRIVACY_CLIENT_VERSION}` +
          `&protocolVersion=${MOBILE_PROTOCOL_VERSION + 1}`,
      )
      .set('Authorization', 'Bearer jwt')
      .expect(426)
      .expect('X-Mobile-Protocol-Version', String(MOBILE_PROTOCOL_VERSION));
    expect(started).toHaveLength(0);
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

  it('uses the server-resolved tenant and the claimed version', async () => {
    await openStream(makeApp(), validStream);

    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      userId: 'user-1',
      tenantSlug: 'acme',
      zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION,
    });
  });

  it('ignores a client-supplied tenant slug', async () => {
    // The room partition (`filterBy(['tenant'])`) must match what /livekit/token
    // and /zones resolve for the same request, so the slug can only come from
    // the server side.
    await openStream(makeApp(), `${validStream}&tenant=somewhere-else`);

    expect(started).toHaveLength(1);
    expect(started[0].tenantSlug).toBe('acme');
  });

  it('reports a failed world join in the protocol instead of ending silently', async () => {
    // Headers and the session frame are already out at that point, so a silent
    // end looks to the app like a healthy stream that closed — and it would
    // reconnect once a second until the rate limiter answers 429.
    worldJoinFails = true;
    await openStream(makeApp(), validStream);
    expect(reportedFailures).toEqual(['world_join_failed']);
  });

  it('refuses to start a session without a resolved tenant', async () => {
    resolvedTenant = null;
    await request(makeApp())
      .get(validStream)
      .set('Authorization', 'Bearer jwt')
      .expect(400, { error: 'tenant_required' });
    expect(started).toHaveLength(0);
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

describe('MOBILE_GATEWAY_ENABLED gate', () => {
  it('registers neither route when unset — both 404 like any unknown path', async () => {
    delete process.env.MOBILE_GATEWAY_ENABLED;

    await request(makeApp()).get(validStream).set('Authorization', 'Bearer jwt').expect(404);
    await request(makeApp())
      .post('/mobile/action')
      .send({ sessionId: '00000000-0000-4000-8000-000000000000', action: { type: 'heartbeat' } })
      .expect(404);
    expect(started).toHaveLength(0);
  });

  it.each(['', '0', 'false', 'off', 'no', '  '])('registers neither route for the falsy value %j', async (value) => {
    process.env.MOBILE_GATEWAY_ENABLED = value;

    await request(makeApp()).get(validStream).set('Authorization', 'Bearer jwt').expect(404);
    await request(makeApp())
      .post('/mobile/action')
      .send({ sessionId: '00000000-0000-4000-8000-000000000000', action: { type: 'heartbeat' } })
      .expect(404);
  });

  it.each(['true', '1', 'on', 'yes', 'TRUE'])('registers both routes for %s', async (value) => {
    process.env.MOBILE_GATEWAY_ENABLED = value;

    await openStream(makeApp(), validStream);
    expect(started).toHaveLength(1);
  });
});
