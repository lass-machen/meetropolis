import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { createLivekitToken } from '../../livekit.js';
import { MIN_ZONE_PRIVACY_CLIENT_VERSION } from '@meetropolis/shared';
import {
  livekitSamples,
  livekitRttSeconds,
  livekitJitterSeconds,
  livekitInboundBitrateBps,
  livekitOutboundBitrateBps,
  livekitPacketLossRatio,
} from '../../metrics.js';
import { requireAuth, getTenantFromReq, requireMembership } from '../utils/authHelpers.js';

function handleHealth(_req: express.Request, res: express.Response): void {
  res.json({ ok: true });
}

function handleConfig(_req: express.Request, res: express.Response): void {
  // /config exposes runtime config the web client needs before authentication.
  // The billingEnabled capability is sourced from /public/config (see
  // admin.system.ts > handleOssPublicConfig + computeBillingEnabled), which
  // resolves it from the loaded EE module — this endpoint deliberately does
  // not read STRIPE_* envs so the OSS server stays Stripe-free.
  res.json({
    livekitUrl: process.env.LIVEKIT_EXTERNAL_URL || process.env.LIVEKIT_URL || 'ws://localhost:7880',
  });
}

async function checkDb(prisma: PrismaClient): Promise<'ok' | 'fail'> {
  try {
    const p = prisma.$queryRaw`SELECT 1` as unknown as Promise<unknown>;
    const withTimeout = new Promise<unknown>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('db-timeout')), 2000);
      p.then((v) => {
        clearTimeout(to);
        resolve(v);
      }).catch((e: unknown) => {
        clearTimeout(to);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
    await withTimeout;
    return 'ok';
  } catch {
    return 'fail';
  }
}

async function checkLivekit(): Promise<'ok' | 'missing'> {
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) return 'missing';
  try {
    await createLivekitToken({
      roomName: 'readyz',
      identity: 'probe',
      canPublish: false,
      canSubscribe: false,
      canPublishData: false,
    });
    return 'ok';
  } catch {
    return 'missing';
  }
}

// H4 audio-zone privacy: the LiveKit *admin* client (livekitAdmin.ts,
// used by reconciler.ts) additionally requires LIVEKIT_URL, which
// `checkLivekit` above never touches — token minting (createLivekitToken)
// only signs a JWT and does not read LIVEKIT_URL at all. A deployment
// that sets LIVEKIT_EXTERNAL_URL (client-facing) but forgets the
// internal LIVEKIT_URL therefore keeps minting tokens fine while the
// admin client silently stays disabled (createLivekitAdminClient returns
// null) — losing the reconciler's LiveKit-side cross-island
// forced-unsubscribe defense-in-depth layer with no operator-visible
// signal. Reported as its own field rather than folded into `ok`: a
// missing admin client is an intentionally supported degraded mode for
// minimal OSS installs (see livekitAdmin.ts's module doc), so it must
// not fail container health checks — but it must not be silent either.
function checkLivekitAdmin(): 'ok' | 'disabled' {
  const hasAdminConfig = Boolean(
    process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET && process.env.LIVEKIT_URL,
  );
  return hasAdminConfig ? 'ok' : 'disabled';
}

export async function handleReadyz(prisma: PrismaClient, _req: express.Request, res: express.Response): Promise<void> {
  const result: { db: 'ok' | 'fail'; livekit: 'ok' | 'missing'; livekitAdmin: 'ok' | 'disabled'; ok: boolean } = {
    db: await checkDb(prisma),
    livekit: await checkLivekit(),
    livekitAdmin: checkLivekitAdmin(),
    ok: false,
  };
  result.ok = result.db === 'ok' && result.livekit === 'ok';
  const status = result.ok ? 200 : 503;
  res.status(status).json(result);
}

function handleLivekitUrl(_req: express.Request, res: express.Response): void {
  const url = process.env.LIVEKIT_EXTERNAL_URL || process.env.LIVEKIT_URL || '';
  res.json({ url });
}

// H4 (audio-zone privacy): only `world` is a valid LiveKit sub-room today.
// The entire zone-membership/allow-list model assumes a single room per
// tenant (`<tenant>:world`) — accepting an arbitrary client-supplied
// roomName would let a client mint a token for a room the zone orchestrator
// never reconciles.
const ALLOWED_LIVEKIT_ROOM_NAMES = new Set(['world']);

const livekitTokenSchema = z.object({
  roomName: z.string().min(1),
  // `identity` is accepted for logging/back-compat only; the server always
  // overrides it with the authenticated user's id (see handleLivekitToken).
  identity: z.string().min(1),
  name: z.string().optional(),
  canPublish: z.boolean().optional(),
  canSubscribe: z.boolean().optional(),
  // H4 hardening: honesty-based client zone-privacy protocol version (see
  // @meetropolis/shared zonePrivacy.ts). Enforced below by downgrading
  // canPublish, not by rejecting the request outright, so an outdated
  // client can still subscribe (hear/see others).
  zonePrivacyVersion: z.number().optional(),
});

// H4 hardening: an outdated client may never have applied the H4 deny-all
// zone-privacy baseline in the first place (see
// rooms/audioZones/reconciler.ts's module doc, risk #1/#6 - subscriber-side
// correction there is fail-open by LiveKit's own semantics). The
// Colyseus-side gate (rooms/lifecycle/onAuth.ts) stops such a client from
// joining the world room at all, but this endpoint is reachable
// independently of a Colyseus join - so this is the SFU-enforced,
// load-bearing fix: deny the publish capability outright instead of
// trusting the client to have applied the boundary. Subscribe is left
// untouched so an outdated client can still hear/see others.
function resolveEffectiveCanPublish(
  requestedCanPublish: boolean | undefined,
  zonePrivacyVersion: number | undefined,
  identity: string,
  corrId: string,
): boolean | undefined {
  const isClientTooOld = typeof zonePrivacyVersion !== 'number' || zonePrivacyVersion < MIN_ZONE_PRIVACY_CLIENT_VERSION;
  if (!isClientTooOld) return requestedCanPublish;
  logger.warn({
    event: 'livekit.token.client_too_old',
    correlationId: corrId || undefined,
    identity,
    zonePrivacyVersion,
    minRequired: MIN_ZONE_PRIVACY_CLIENT_VERSION,
  });
  return false;
}

export async function handleLivekitToken(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const parse = livekitTokenSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'roomName and identity required' });
    return;
  }
  const { roomName, identity: clientSuppliedIdentity, name, canPublish, canSubscribe, zonePrivacyVersion } = parse.data;
  if (!ALLOWED_LIVEKIT_ROOM_NAMES.has(roomName)) {
    res.status(400).json({ error: 'invalid_room_name' });
    return;
  }
  // Identity is ALWAYS the authenticated user id, never client input.
  // The zone-membership model (WorldRoom Player.identity, audioZones/*) is
  // keyed on this value; trusting a client-supplied identity would let a
  // user mint a token that impersonates another participant and bypass
  // every allow-list computed from Colyseus state.
  const identity = auth.userId;
  try {
    const corrId = (req.headers['x-correlation-id'] || '').toString();
    if (clientSuppliedIdentity !== identity) {
      logger.warn({
        event: 'livekit.token.identity_override',
        correlationId: corrId || undefined,
        requestedIdentity: clientSuppliedIdentity,
        authenticatedIdentity: identity,
      });
    }
    try {
      logger.info({
        event: 'livekit.token.request',
        correlationId: corrId || undefined,
        roomName,
        identity,
        ua: (req.headers['user-agent'] || '').toString(),
      });
    } catch {}
    if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      res.status(500).json({ error: 'livekit not configured' });
      return;
    }
    const tenant = getTenantFromReq(req);
    if (!tenant) {
      res.status(400).json({ error: 'tenant_required' });
      return;
    }
    // Tenant resolution (tenancy.ts) lets the client X-Tenant header override
    // the session JWT, so without this check any user could mint a token for a
    // FOREIGN tenant's AV room (enumerate + publish). Gate on real membership:
    // an AV join needs no elevated role, so any role (incl. guest) qualifies; a
    // spoofed foreign tenant does not. Generic 403 keeps it non-enumerable.
    const membership = await requireMembership(req, identity, prisma);
    if (!membership) {
      logger.warn({ event: 'livekit.token.forbidden', correlationId: corrId || undefined, identity });
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const effectiveCanPublish = resolveEffectiveCanPublish(canPublish, zonePrivacyVersion, identity, corrId);
    const roomNameWithTenant = `${tenant.slug}:${roomName}`;
    const token = await createLivekitToken({
      roomName: roomNameWithTenant,
      identity,
      name,
      canPublish: effectiveCanPublish,
      canPublishData: true,
      canSubscribe,
    });
    res.type('text/plain').send(token);
  } catch (e: unknown) {
    logger.error({ event: 'livekit.token.error', error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: 'failed to create token' });
  }
}

const avStatsSchema = z.object({
  roomName: z.string().min(1),
  identity: z.string().min(1),
  rttMs: z.number().nonnegative().optional(),
  jitterMs: z.number().nonnegative().optional(),
  inboundBitrateBps: z.number().nonnegative().optional(),
  outboundBitrateBps: z.number().nonnegative().optional(),
  packetLossRatio: z.number().min(0).max(1).optional(),
  connectionState: z.string().optional(),
  dtlsState: z.string().optional(),
  iceState: z.string().optional(),
  nRemoteAudio: z.number().int().nonnegative().optional(),
  nRemoteVideo: z.number().int().nonnegative().optional(),
  nLocalAudio: z.number().int().nonnegative().optional(),
  nLocalVideo: z.number().int().nonnegative().optional(),
});

function recordAvStatsMetrics(p: z.infer<typeof avStatsSchema>) {
  livekitSamples.inc();
  if (typeof p.rttMs === 'number' && Number.isFinite(p.rttMs)) {
    livekitRttSeconds.observe(p.rttMs / 1000);
  }
  if (typeof p.jitterMs === 'number' && Number.isFinite(p.jitterMs)) {
    livekitJitterSeconds.observe(p.jitterMs / 1000);
  }
  if (typeof p.inboundBitrateBps === 'number' && Number.isFinite(p.inboundBitrateBps)) {
    livekitInboundBitrateBps.observe(p.inboundBitrateBps);
  }
  if (typeof p.outboundBitrateBps === 'number' && Number.isFinite(p.outboundBitrateBps)) {
    livekitOutboundBitrateBps.observe(p.outboundBitrateBps);
  }
  if (typeof p.packetLossRatio === 'number' && Number.isFinite(p.packetLossRatio)) {
    livekitPacketLossRatio.observe(p.packetLossRatio);
  }
}

function handleAvStats(req: express.Request, res: express.Response): void {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const parse = avStatsSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'invalid stats payload' });
    return;
  }
  const p = parse.data;
  try {
    recordAvStatsMetrics(p);
    try {
      logger.debug({
        event: 'av.stats',
        roomName: p.roomName,
        identity: p.identity,
        connectionState: p.connectionState,
        dtlsState: p.dtlsState,
        iceState: p.iceState,
      });
    } catch {}
    res.json({ ok: true });
  } catch (e) {
    logger.error({ event: 'av.stats.error', error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: 'stats ingest failed' });
  }
}

export function registerHealthRoutes(app: express.Application, prisma: PrismaClient) {
  app.get('/health', handleHealth);
  app.get('/healthz', handleHealth);
  app.get('/config', handleConfig);
  app.get('/readyz', (req, res) => handleReadyz(prisma, req, res));
  app.get('/livekit/url', handleLivekitUrl);
  app.post('/livekit/token', (req, res) => handleLivekitToken(prisma, req, res));
  app.post('/av/stats', handleAvStats);
}
