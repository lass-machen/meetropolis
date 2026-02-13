import type { NpcSpawnCommand, NpcRoomCommand } from '@meetropolis/shared';
import { NpcBot } from './bot/npcBot.js';
import { logger } from './index.js';

interface BotStatus {
  identity: string;
  tenantSlug: string;
  connected: boolean;
}

class BotManager {
  private bots = new Map<string, NpcBot>();

  private key(tenantSlug: string, identity: string): string {
    return `${tenantSlug}:${identity}`;
  }

  async spawn(command: NpcSpawnCommand): Promise<void> {
    const k = this.key(command.tenantSlug, command.npc.identity);
    if (this.bots.has(k)) {
      logger.warn(`[BotManager] Bot ${k} already exists, despawning first`);
      await this.despawn(command.tenantSlug, command.npc.identity);
    }
    const bot = new NpcBot(command);
    this.bots.set(k, bot);
    await bot.start();
    logger.info(`[BotManager] Bot ${k} spawned`);
  }

  async despawn(tenantSlug: string, identity: string): Promise<void> {
    const k = this.key(tenantSlug, identity);
    const bot = this.bots.get(k);
    if (!bot) {
      logger.warn(`[BotManager] Bot ${k} not found for despawn`);
      return;
    }
    await bot.stop();
    this.bots.delete(k);
    logger.info(`[BotManager] Bot ${k} despawned`);
  }

  sendCommand(tenantSlug: string, identity: string, command: NpcRoomCommand): void {
    const k = this.key(tenantSlug, identity);
    const bot = this.bots.get(k);
    if (!bot) throw new Error(`Bot ${k} not found`);
    bot.handleCommand(command);
  }

  getStatusAll(): BotStatus[] {
    const result: BotStatus[] = [];
    for (const [k, bot] of this.bots) {
      const separatorIndex = k.indexOf(':');
      const tenantSlug = k.slice(0, separatorIndex);
      const identity = k.slice(separatorIndex + 1);
      result.push({ identity, tenantSlug, connected: bot.isConnected() });
    }
    return result;
  }

  async shutdownAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [k, bot] of this.bots) {
      promises.push(
        bot.stop().catch((e) => {
          logger.error(`[BotManager] Error stopping ${k}:`, e);
        }),
      );
    }
    await Promise.all(promises);
    this.bots.clear();
  }
}

export const botManager = new BotManager();
