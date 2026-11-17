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
import { requireAuth, getTenantFromReq } from '../utils/authHelpers.js';
import { validateTenantSessionFresh } from '../utils/sessionAuth.js';
import { readAuthCookie, readBearerToken } from '../../types/authShapes.js';
import { evaluateTranscriptionGate } from '../../rooms/lifecycle/transcriptionGate.js';
import { avSessionMetadata, isReservedAvIdentity } from '../../rooms/lifecycle/avSessionRef.js';
import { isAvWorldPresenceCurrent, resolveAvWorldPresence } from '../../rooms/lifecycle/avWorldPresence.js';

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

function respondTranscriptionConsentRequired(res: express.Response): void {
  res.status(403).json({ error: 'transcription_consent_required' });
}

function respondTranscriptionGateUnavailable(res: express.Response): void {
  res.status(503).json({ error: 'transcription_gate_unavailable' });
}

function respondWorldSessionRequired(
  res: express.Response,
  event: 'livekit.token.no_world_presence' | 'livekit.token.world_presence_lost',
  corrId: string,
): void {
  logger.warn({ event, correlationId: corrId || undefined });
  res.status(403).json({ error: 'world_session_required' });
}

export async function handleLivekitToken(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
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
  const corrId = (req.headers['x-correlation-id'] || '').toString();
  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return;
  }
  // A LiveKit token belongs to a login session: the raw token from cookie or
  // bearer header is checked against the database, so an API token fails.
  const rawToken = readAuthCookie(req) ?? readBearerToken(req);
  if (!rawToken) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const session = await validateTenantSessionFresh(prisma, rawToken, tenant.id);
    if (session.status !== 'allowed') {
      const forbidden = session.status === 'forbidden';
      const reason = forbidden ? session.reason : session.status;
      logger.warn({ event: 'livekit.token.session_rejected', correlationId: corrId || undefined, reason });
      res.status(forbidden ? 403 : 401).json({ error: forbidden ? 'forbidden' : 'unauthorized' });
      return;
    }
    const identity = session.userId;
    if (isReservedAvIdentity(identity)) {
      logger.warn({ event: 'livekit.token.reserved_identity', correlationId: corrId || undefined });
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    if (clientSuppliedIdentity !== identity) {
      logger.warn({
        event: 'livekit.token.identity_override',
        correlationId: corrId || undefined,
        requestedIdentity: clientSuppliedIdentity,
        authenticatedIdentity: identity,
      });
    }
    try {
      logger.info({ event: 'livekit.token.request', correlationId: corrId || undefined, roomName, identity });
    } catch {}
    if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      res.status(500).json({ error: 'livekit not configured' });
      return;
    }
    // The membership is read for its end date only; the access was decided above.
    const membership = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: tenant.id, userId: identity } },
      select: { expiresAt: true },
    });
    const gateDecision = await evaluateTranscriptionGate(prisma, tenant.id, identity);
    if (gateDecision === 'consent_required') return respondTranscriptionConsentRequired(res);
    if (gateDecision === 'unavailable') return respondTranscriptionGateUnavailable(res);
    // World presence: the token belongs to exactly one currently
    // materialized human world session of this verified login session.
    const worldProof = resolveAvWorldPresence({
      userId: identity,
      authSessionId: session.sessionId,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
    });
    if (!worldProof) return respondWorldSessionRequired(res, 'livekit.token.no_world_presence', corrId);
    const effectiveCanPublish = resolveEffectiveCanPublish(canPublish, zonePrivacyVersion, identity, corrId);
    const token = await createLivekitToken({
      roomName: `${tenant.slug}:${roomName}`,
      identity,
      accessExpiresAt: membership?.expiresAt ?? null,
      metadata: avSessionMetadata(session.sessionId),
      name,
      canPublish: effectiveCanPublish,
      canPublishData: true,
      canSubscribe,
    });
    // Re-confirm the pinned world registration immediately before delivery:
    // a presence lost, revoked, expired, re-registered, or with a changed epoch
    // while signing never reaches the caller. The minted token stays
    // undelivered and therefore grants nothing.
    if (!isAvWorldPresenceCurrent(worldProof))
      return respondWorldSessionRequired(res, 'livekit.token.world_presence_lost', corrId);
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
