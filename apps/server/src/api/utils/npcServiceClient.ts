import { logger } from '../../logger.js';
import type { NpcSpawnCommand } from '@meetropolis/shared';

const NPC_SERVICE_URL = () => process.env.NPC_SERVICE_URL || 'http://npc-service:3100';
const NPC_SERVICE_SECRET = () => process.env.NPC_SERVICE_SECRET || 'dev-npc-secret';

async function npcFetch(path: string, method: string, body?: unknown): Promise<unknown> {
  const url = `${NPC_SERVICE_URL()}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-NPC-Secret': NPC_SERVICE_SECRET(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown');
    throw new Error(`NPC service error: ${res.status} ${text}`);
  }
  return res.json();
}

export async function npcServiceSpawn(command: NpcSpawnCommand): Promise<unknown> {
  logger.info('[NPC Client] spawn request', { identity: command.npc.identity });
  return npcFetch('/bots/spawn', 'POST', command);
}

export async function npcServiceDespawn(identity: string, tenantSlug: string): Promise<unknown> {
  logger.info('[NPC Client] despawn request', { identity, tenantSlug });
  return npcFetch('/bots/despawn', 'POST', { identity, tenantSlug });
}

export async function npcServiceStatus(): Promise<unknown> {
  return npcFetch('/bots', 'GET');
}
