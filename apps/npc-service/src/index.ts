import 'dotenv/config';
import express from 'express';
import pino from 'pino';
import type { NpcDefinition } from '@meetropolis/shared';
import { config } from './config.js';
import { registerHttpApi } from './httpApi.js';
import { botManager } from './botManager.js';

interface NpcListEntry extends NpcDefinition {
  tenant?: { slug: string } | null;
}

export const logger = pino({ level: config.logLevel });

const app = express();
app.use(express.json());

// Health check
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, bots: botManager.getStatusAll().length });
});

registerHttpApi(app);

const server = app.listen(config.port, () => {
  logger.info(`NPC Service listening on :${config.port}`);
});

// Auto-respawn enabled NPCs on boot
async function autoRespawn(): Promise<void> {
  try {
    const url = `${config.serverUrl}/npcs?enabled=true`;
    const res = await fetch(url, {
      headers: { 'x-npc-secret': config.npcServiceSecret },
    });
    if (!res.ok) {
      logger.warn(`[Boot] Failed to fetch NPCs: ${res.status}`);
      return;
    }
    const payload: unknown = await res.json();
    if (!Array.isArray(payload)) return;
    const npcs = payload as NpcListEntry[];
    logger.info(`[Boot] Auto-respawning ${npcs.length} enabled NPCs`);
    for (const npc of npcs) {
      try {
        await botManager.spawn({
          npc,
          tenantSlug: npc.tenant?.slug || 'default',
          serverUrl: config.serverUrl,
          livekitUrl: config.livekitUrl,
          livekitApiKey: config.livekitApiKey,
          livekitApiSecret: config.livekitApiSecret,
        });
      } catch (e) {
        logger.error({ err: e }, `[Boot] Failed to spawn NPC ${npc.identity}`);
      }
    }
  } catch (e) {
    logger.warn({ err: e }, '[Boot] Auto-respawn failed (server may not be ready yet)');
  }
}

// Delay auto-respawn to give server time to start
setTimeout(() => void autoRespawn(), 5000);

// Graceful shutdown
async function shutdown(): Promise<void> {
  logger.info('[Shutdown] Stopping all bots...');
  await botManager.shutdownAll();
  server.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
