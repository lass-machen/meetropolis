import type express from 'express';
import { PrismaClient } from '@prisma/client';
import { createLivekitToken } from './livekit.js';

const prisma = new PrismaClient();

export function registerApi(app: express.Express) {
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.get('/maps', async (_req, res) => {
    const maps = await prisma.map.findMany({ include: { zones: true, rooms: true } });
    res.json(maps);
  });

  app.get('/zones', async (_req, res) => {
    const zones = await prisma.zone.findMany();
    res.json(zones);
  });

  app.post('/livekit/token', async (req, res) => {
    const { roomName, identity, name, canPublish, canSubscribe } = req.body ?? {};
    if (!roomName || !identity) return res.status(400).json({ error: 'roomName and identity required' });
    const token = await createLivekitToken({ roomName, identity, name, canPublish, canPublishData: true, canSubscribe });
    // debug: token length
    // eslint-disable-next-line no-console
    console.log('LiveKit token generated', typeof token, token.length);
    // Return raw string token for simpler client handling
    res.type('text/plain').send(token);
  });
}
