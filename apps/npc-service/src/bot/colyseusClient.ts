import * as Colyseus from 'colyseus.js';
import type { NpcSpawnCommand } from '@meetropolis/shared';
import { logger } from '../index.js';

type NpcCommandData = { npcIdentity: string; action: string; payload?: Record<string, unknown> };
type NpcCommandCallback = (data: NpcCommandData) => void;

export class ColyseusClient {
  private command: NpcSpawnCommand;
  private room: Colyseus.Room | null = null;
  private client: Colyseus.Client;
  private connected = false;
  private commandCallbacks: NpcCommandCallback[] = [];
  private alive = false;
  private reconnectAttempts = 0;

  private static MAX_RECONNECT_ATTEMPTS = 10;
  private static RECONNECT_BASE_DELAY_MS = 2000;

  constructor(command: NpcSpawnCommand) {
    this.command = command;
    const wsUrl = command.serverUrl.replace(/^http(s?):\/\//, 'ws$1://');
    this.client = new Colyseus.Client(wsUrl);
  }

  async connect(): Promise<void> {
    this.alive = true;
    this.room = await this.joinWithRetry(6, 200);
    this.connected = true;
    this.reconnectAttempts = 0;
    this.setupRoomListeners();
  }

  private setupRoomListeners(): void {
    if (!this.room) return;
    const { npc } = this.command;

    this.room.onMessage('npc_command', (data: NpcCommandData) => {
      for (const cb of this.commandCallbacks) {
        try {
          cb(data);
        } catch { /* callback errors should not crash the client */ }
      }
    });

    this.room.onLeave((code) => {
      this.connected = false;
      logger.warn(`[ColyseusClient ${npc.identity}] Left room with code ${code}`);
      if (this.alive) {
        this.scheduleReconnect();
      }
    });

    this.room.onError((code, message) => {
      logger.error(`[ColyseusClient ${npc.identity}] Error: ${code} ${message}`);
    });
  }

  private scheduleReconnect(): void {
    const identity = this.command.npc.identity;
    if (this.reconnectAttempts >= ColyseusClient.MAX_RECONNECT_ATTEMPTS) {
      logger.error(`[ColyseusClient ${identity}] Max reconnect attempts (${ColyseusClient.MAX_RECONNECT_ATTEMPTS}) reached, giving up`);
      return;
    }
    const delay = Math.min(30000, ColyseusClient.RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts));
    this.reconnectAttempts++;
    logger.info(`[ColyseusClient ${identity}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${ColyseusClient.MAX_RECONNECT_ATTEMPTS})`);

    setTimeout(async () => {
      if (!this.alive) return;
      try {
        this.room = await this.joinWithRetry(3, 500);
        this.connected = true;
        this.reconnectAttempts = 0;
        this.setupRoomListeners();
        logger.info(`[ColyseusClient ${identity}] Reconnected successfully`);
      } catch (e) {
        logger.error({ err: e }, `[ColyseusClient ${identity}] Reconnect attempt ${this.reconnectAttempts} failed`);
        this.scheduleReconnect();
      }
    }, delay);
  }

  private async joinWithRetry(maxAttempts: number, baseDelayMs: number): Promise<Colyseus.Room> {
    const { npc, tenantSlug } = this.command;
    let attempt = 0;
    while (true) {
      try {
        return await this.client.joinOrCreate('world', {
          tenant: tenantSlug,
          identity: `npc-${npc.identity}`,
          name: npc.name,
          avatarId: npc.avatarId,
          x: npc.spawnX,
          y: npc.spawnY,
          direction: npc.spawnDirection,
        });
      } catch (e: unknown) {
        attempt++;
        if (attempt >= maxAttempts) throw e;
        const delay = Math.min(5000, baseDelayMs * Math.pow(2, attempt - 1));
        logger.debug(`[ColyseusClient ${npc.identity}] Join attempt ${attempt} failed, retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  onNpcCommand(callback: NpcCommandCallback): void {
    this.commandCallbacks.push(callback);
  }

  sendMove(x: number, y: number, direction: string): void {
    try {
      this.room?.send('move', { x, y, direction });
    } catch { /* silently ignore send errors on disconnected room */ }
  }

  sendDnd(dnd: boolean): void {
    try {
      this.room?.send('dnd_status', { dnd });
    } catch { /* silently ignore send errors on disconnected room */ }
  }

  sendAvatarChange(avatarId: string): void {
    try {
      this.room?.send('avatar_change', { avatarId });
    } catch { /* silently ignore send errors on disconnected room */ }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    this.alive = false; // Prevent reconnection attempts
    this.connected = false;
    try {
      await this.room?.leave();
    } catch { /* room may already be disconnected */ }
    this.room = null;
  }
}
