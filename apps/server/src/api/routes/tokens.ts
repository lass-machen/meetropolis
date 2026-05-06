import express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import crypto from 'crypto';
import { pathParam } from '../utils/requestHelpers.js';

export function registerApiTokenRoutes(
  app: express.Application,
  prisma: PrismaClient,
  requireAuth: (req: express.Request) => { userId: string; tenantId?: string } | null,
  apiTokenPepper: string
) {
  // GET /api-tokens
  app.get('/api-tokens', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const list = await prisma.apiToken.findMany({ where: { userId: auth.userId }, orderBy: { createdAt: 'desc' } });
    res.json(list.map((t: any) => ({ id: t.id, name: t.name, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt })));
  });

  // POST /api-tokens
  app.post('/api-tokens', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const schema = z.object({ name: z.string().min(1).max(100).optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    const raw = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(apiTokenPepper + raw).digest('hex');
    const rec = await prisma.apiToken.create({ data: { userId: auth.userId, name: parse.data.name, hash } });
    res.json({ id: rec.id, token: raw, name: rec.name, createdAt: rec.createdAt });
  });

  // DELETE /api-tokens/:id
  app.delete('/api-tokens/:id', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const id = pathParam(req, 'id');
    try {
      const tok = await prisma.apiToken.findUnique({ where: { id } });
      if (!tok || tok.userId !== auth.userId) return res.status(404).json({ error: 'not found' });
      await prisma.apiToken.delete({ where: { id } });
      res.json({ ok: true });
    } catch {
      res.status(400).json({ error: 'delete failed' });
    }
  });
}


