import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { createLivekitToken } from '../../livekit.js';
import { livekitSamples, livekitRttSeconds, livekitJitterSeconds, livekitInboundBitrateBps, livekitOutboundBitrateBps, livekitPacketLossRatio } from '../../metrics.js';
import { requireAuth, getTenantFromReq } from '../utils/authHelpers.js';

export function registerHealthRoutes(app: express.Application, prisma: PrismaClient) {
  // Health check
  app.get('/health', (_req: express.Request, res: express.Response) => res.json({ ok: true }));

  // Liveness probe
  app.get('/healthz', (_req: express.Request, res: express.Response) => res.json({ ok: true }));

  // Public Client Config (Auto-Discovery helper)
  app.get('/config', (_req: express.Request, res: express.Response) => {
    res.json({
      livekitUrl: process.env.LIVEKIT_EXTERNAL_URL || process.env.LIVEKIT_URL || 'ws://localhost:7880',
      billingEnabled: !!process.env.STRIPE_SECRET_KEY,
    });
  });

  // Readiness probe
  app.get('/readyz', async (_req: express.Request, res: express.Response) => {
    const result: { db: 'ok' | 'fail'; livekit: 'ok' | 'missing'; ok: boolean } = {
      db: 'fail',
      livekit: 'missing',
      ok: false,
    };
    try {
      const p = prisma.$queryRaw`SELECT 1` as unknown as Promise<any>;
      const withTimeout = new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('db-timeout')), 2000);
        p.then((v) => { clearTimeout(to); resolve(v); }).catch((e) => { clearTimeout(to); reject(e); });
      });
      await withTimeout;
      result.db = 'ok';
    } catch {
      result.db = 'fail';
    }
    if (process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
      try {
        await createLivekitToken({ roomName: 'readyz', identity: 'probe', canPublish: false, canSubscribe: false, canPublishData: false });
        result.livekit = 'ok';
      } catch {
        result.livekit = 'missing';
      }
    } else {
      result.livekit = 'missing';
    }
    result.ok = result.db === 'ok' && result.livekit === 'ok';
    const status = result.ok ? 200 : 503;
    res.status(status).json(result);
  });

  // LiveKit URL endpoint
  app.get('/livekit/url', async (_req: express.Request, res: express.Response) => {
    const url = process.env.LIVEKIT_EXTERNAL_URL || process.env.LIVEKIT_URL || '';
    res.json({ url });
  });

  // LiveKit token
  app.post('/livekit/token', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const schema = z.object({ roomName: z.string().min(1), identity: z.string().min(1), name: z.string().optional(), canPublish: z.boolean().optional(), canSubscribe: z.boolean().optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'roomName and identity required' });
    const { roomName, identity, name, canPublish, canSubscribe } = parse.data;
    try {
      const corrId = (req.headers['x-correlation-id'] || '').toString();
      const hdrIdentity = (req.headers['x-av-identity'] || '').toString();
      const hdrRoom = (req.headers['x-av-room'] || '').toString();
      try {
        logger.info({ event: 'livekit.token.request', correlationId: corrId || undefined, roomName: roomName || hdrRoom || undefined, identity: identity || hdrIdentity || undefined, ua: (req.headers['user-agent'] || '').toString() });
      } catch { }
      if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
        return res.status(500).json({ error: 'livekit not configured' });
      }
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });
      const roomNameWithTenant = `${tenant.slug}:${roomName}`;
      const token = await createLivekitToken({ roomName: roomNameWithTenant, identity, name, canPublish, canPublishData: true, canSubscribe });
      res.type('text/plain').send(token);
    } catch (e: unknown) {
      logger.error({ event: 'livekit.token.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'failed to create token' });
    }
  });

  // Client-reported WebRTC/LiveKit stats (RUM)
  app.post('/av/stats', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const schema = z.object({
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
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid stats payload' });
    const p = parse.data;
    try {
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
      try { logger.debug({ event: 'av.stats', roomName: p.roomName, identity: p.identity, connectionState: p.connectionState, dtlsState: p.dtlsState, iceState: p.iceState }); } catch { }
      return res.json({ ok: true });
    } catch (e) {
      logger.error({ event: 'av.stats.error', error: (e as any)?.message || String(e) });
      return res.status(500).json({ error: 'stats ingest failed' });
    }
  });
}
