import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { createLivekitToken } from '../../livekit.js';
import { livekitSamples, livekitRttSeconds, livekitJitterSeconds, livekitInboundBitrateBps, livekitOutboundBitrateBps, livekitPacketLossRatio } from '../../metrics.js';
import { requireAuth, getTenantFromReq } from '../utils/authHelpers.js';

function handleHealth(_req: express.Request, res: express.Response): void {
  res.json({ ok: true });
}

function handleConfig(_req: express.Request, res: express.Response): void {
  res.json({
    livekitUrl: process.env.LIVEKIT_EXTERNAL_URL || process.env.LIVEKIT_URL || 'ws://localhost:7880',
    billingEnabled: !!process.env.STRIPE_SECRET_KEY,
  });
}

async function checkDb(prisma: PrismaClient): Promise<'ok' | 'fail'> {
  try {
    const p = prisma.$queryRaw`SELECT 1` as unknown as Promise<any>;
    const withTimeout = new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('db-timeout')), 2000);
      p.then((v) => { clearTimeout(to); resolve(v); }).catch((e) => { clearTimeout(to); reject(e); });
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
    await createLivekitToken({ roomName: 'readyz', identity: 'probe', canPublish: false, canSubscribe: false, canPublishData: false });
    return 'ok';
  } catch {
    return 'missing';
  }
}

async function handleReadyz(prisma: PrismaClient, _req: express.Request, res: express.Response): Promise<void> {
  const result: { db: 'ok' | 'fail'; livekit: 'ok' | 'missing'; ok: boolean } = {
    db: await checkDb(prisma),
    livekit: await checkLivekit(),
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

const livekitTokenSchema = z.object({
  roomName: z.string().min(1),
  identity: z.string().min(1),
  name: z.string().optional(),
  canPublish: z.boolean().optional(),
  canSubscribe: z.boolean().optional(),
});

async function handleLivekitToken(req: express.Request, res: express.Response): Promise<void> {
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
  const { roomName, identity, name, canPublish, canSubscribe } = parse.data;
  try {
    const corrId = (req.headers['x-correlation-id'] || '').toString();
    const hdrIdentity = (req.headers['x-av-identity'] || '').toString();
    const hdrRoom = (req.headers['x-av-room'] || '').toString();
    try {
      logger.info({ event: 'livekit.token.request', correlationId: corrId || undefined, roomName: roomName || hdrRoom || undefined, identity: identity || hdrIdentity || undefined, ua: (req.headers['user-agent'] || '').toString() });
    } catch { }
    if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      res.status(500).json({ error: 'livekit not configured' });
      return;
    }
    const tenant = getTenantFromReq(req);
    if (!tenant) {
      res.status(400).json({ error: 'tenant_required' });
      return;
    }
    const roomNameWithTenant = `${tenant.slug}:${roomName}`;
    const token = await createLivekitToken({ roomName: roomNameWithTenant, identity, name, canPublish, canPublishData: true, canSubscribe });
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

async function handleAvStats(req: express.Request, res: express.Response): Promise<void> {
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
    try { logger.debug({ event: 'av.stats', roomName: p.roomName, identity: p.identity, connectionState: p.connectionState, dtlsState: p.dtlsState, iceState: p.iceState }); } catch { }
    res.json({ ok: true });
  } catch (e) {
    logger.error({ event: 'av.stats.error', error: (e as any)?.message || String(e) });
    res.status(500).json({ error: 'stats ingest failed' });
  }
}

export function registerHealthRoutes(app: express.Application, prisma: PrismaClient) {
  app.get('/health', handleHealth);
  app.get('/healthz', handleHealth);
  app.get('/config', handleConfig);
  app.get('/readyz', (req, res) => handleReadyz(prisma, req, res));
  app.get('/livekit/url', handleLivekitUrl);
  app.post('/livekit/token', handleLivekitToken);
  app.post('/av/stats', handleAvStats);
}
