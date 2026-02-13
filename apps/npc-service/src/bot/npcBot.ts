import type { NpcSpawnCommand, NpcRoomCommand } from '@meetropolis/shared';
import { ColyseusClient } from './colyseusClient.js';
import { LivekitPublisher } from './livekitPublisher.js';
import { MovementEngine } from './movement.js';
import { logger } from '../index.js';
import { config } from '../config.js';

export class NpcBot {
  private command: NpcSpawnCommand;
  private colyseus: ColyseusClient;
  private livekit: LivekitPublisher;
  private movement: MovementEngine;
  private alive = false;

  constructor(command: NpcSpawnCommand) {
    this.command = command;
    this.colyseus = new ColyseusClient(command);
    this.livekit = new LivekitPublisher(command);
    this.movement = new MovementEngine((x, y, direction) => {
      this.colyseus.sendMove(x, y, direction);
    });
  }

  async start(): Promise<void> {
    this.alive = true;
    const identity = this.command.npc.identity;

    // Connect to Colyseus
    await this.colyseus.connect();

    // Initialize movement engine with the NPC's spawn position so the first
    // moveTo() interpolates from the actual spawn point instead of (0, 0).
    this.movement.setPosition(this.command.npc.spawnX, this.command.npc.spawnY);

    // Listen for npc_command messages
    this.colyseus.onNpcCommand((data) => {
      if (data.npcIdentity !== identity) return;
      this.handleCommand({ action: data.action, payload: data.payload } as NpcRoomCommand);
    });

    // Connect to LiveKit
    try {
      await this.livekit.connect();
    } catch (e) {
      logger.warn({ err: e }, `[NpcBot ${identity}] LiveKit connect failed (will retry on media play)`);
    }

    logger.info(`[NpcBot ${identity}] Started`);
  }

  async stop(): Promise<void> {
    this.alive = false;
    this.movement.stop();
    await this.livekit.disconnect();
    await this.colyseus.disconnect();
    logger.info(`[NpcBot ${this.command.npc.identity}] Stopped`);
  }

  isConnected(): boolean {
    return this.alive && this.colyseus.isConnected();
  }

  handleCommand(cmd: NpcRoomCommand): void {
    if (!this.alive) return;
    const identity = this.command.npc.identity;

    switch (cmd.action) {
      case 'move':
        this.handleMove(identity, cmd.payload);
        break;
      case 'stop_movement':
        logger.info(`[NpcBot ${identity}] stop_movement`);
        this.movement.stop();
        break;
      case 'play_audio':
        this.handlePlayMedia(identity, 'play_audio', cmd.payload);
        break;
      case 'play_video':
        this.handlePlayMedia(identity, 'play_video', cmd.payload);
        break;
      case 'play_screenshare':
        this.handlePlayMedia(identity, 'play_screenshare', cmd.payload);
        break;
      case 'stop_media':
        this.handleStopMedia(identity);
        break;
      case 'set_dnd':
        logger.info(`[NpcBot ${identity}] set_dnd ${cmd.payload.dnd}`);
        this.colyseus.sendDnd(cmd.payload.dnd);
        break;
      case 'set_avatar':
        logger.info(`[NpcBot ${identity}] set_avatar ${cmd.payload.avatarId}`);
        this.colyseus.sendAvatarChange(cmd.payload.avatarId);
        break;
    }
  }

  private handleMove(identity: string, payload: { x: number; y: number; speed?: number }): void {
    logger.debug(`[NpcBot ${identity}] move to ${payload.x},${payload.y}`);
    this.movement.moveTo(payload.x, payload.y, payload.speed);
  }

  private handlePlayMedia(
    identity: string,
    action: 'play_audio' | 'play_video' | 'play_screenshare',
    payload: { mediaFileId: string; loop?: boolean },
  ): void {
    logger.info(`[NpcBot ${identity}] ${action} ${payload.mediaFileId}`);
    const filePath = this.resolveMediaPath(payload.mediaFileId);
    const publishFn =
      action === 'play_audio'
        ? this.livekit.publishAudio.bind(this.livekit)
        : action === 'play_video'
          ? this.livekit.publishVideo.bind(this.livekit)
          : this.livekit.publishScreenshare.bind(this.livekit);

    publishFn(filePath, payload.loop).catch((e) => {
      logger.error(`[NpcBot ${identity}] ${action} failed:`, e);
    });
  }

  private handleStopMedia(identity: string): void {
    logger.info(`[NpcBot ${identity}] stop_media`);
    this.livekit.stopAllMedia().catch((e) => {
      logger.error(`[NpcBot ${identity}] stop_media failed:`, e);
    });
  }

  private resolveMediaPath(mediaFileId: string): string {
    return `${config.npcMediaDir}/${mediaFileId}`;
  }
}
