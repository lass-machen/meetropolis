import type express from 'express';
import { z } from 'zod';

export function registerControlRoutes(
  app: express.Application,
  requireAuth: (req: express.Request) => { userId: string; tenantId?: string } | null,
  requireApiToken: (req: express.Request) => Promise<{ userId: string } | null>
) {
  // Remote controls (session or API token)
  app.post('/controls', async (req: express.Request, res: express.Response) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    const schema = z.object({
      mic: z.boolean().optional(),
      cam: z.boolean().optional(),
      share: z.boolean().optional(),
      dnd: z.boolean().optional(),
    }).refine(v => (v.mic !== undefined || v.cam !== undefined || v.share !== undefined || v.dnd !== undefined), { message: 'at least one field required' });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });

    const gameServer = global.gameServer;
    if (!gameServer) return res.status(500).json({ error: 'game server not available' });

    const payload = parse.data;
    let delivered = 0;
    let roomArray: any[] = [];

    const activeWorldRooms = global.activeWorldRooms;
    if (activeWorldRooms && activeWorldRooms.size > 0) {
      roomArray = Array.from(activeWorldRooms);
    } else if (gameServer.matchMaker) {
      const allRooms = await gameServer.matchMaker.query({}) || [];
      roomArray = allRooms;
    } else if (gameServer.rooms) {
      const vals = Array.isArray(gameServer.rooms) ? gameServer.rooms : Array.from(gameServer.rooms.values?.() || []);
      roomArray = vals;
    }

    for (const room of roomArray) {
      try {
        if (typeof room?.broadcast === 'function') {
          room.broadcast('remote_controls', { from: auth.userId, payload });
          delivered++;
        }
      } catch {}
    }
    if (delivered === 0) return res.status(409).json({ error: 'no_active_targets' });
    res.json({ ok: true, delivered });
  });

  // Controls for a specific identity (session or API token)
  app.post('/controls/for/:identity', async (req: express.Request, res: express.Response) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    const schema = z.object({
      mic: z.boolean().optional(),
      cam: z.boolean().optional(),
      share: z.boolean().optional(),
      dnd: z.boolean().optional(),
    }).refine(v => (v.mic !== undefined || v.cam !== undefined || v.share !== undefined || v.dnd !== undefined), { message: 'at least one field required' });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });

    const identity = req.params.identity;
    if (!identity) return res.status(400).json({ error: 'identity required' });

    const gameServer = global.gameServer;
    if (!gameServer) return res.status(500).json({ error: 'game server not available' });

    const payload = parse.data;
    let delivered = 0;
    let roomArray: any[] = [];

    const activeWorldRooms = global.activeWorldRooms;
    if (activeWorldRooms && activeWorldRooms.size > 0) {
      roomArray = Array.from(activeWorldRooms);
    } else if (gameServer.matchMaker) {
      const allRooms = await gameServer.matchMaker.query({}) || [];
      roomArray = allRooms;
    } else if (gameServer.rooms) {
      const vals = Array.isArray(gameServer.rooms) ? gameServer.rooms : Array.from(gameServer.rooms.values?.() || []);
      roomArray = vals;
    }

    for (const room of roomArray) {
      try {
        if (typeof room?.broadcast === 'function') {
          room.broadcast('remote_controls_for', { forIdentity: identity, from: auth.userId, payload });
          delivered++;
        }
      } catch {}
    }
    if (delivered === 0) return res.status(409).json({ error: 'no_active_targets' });
    res.json({ ok: true, delivered });
  });
}

