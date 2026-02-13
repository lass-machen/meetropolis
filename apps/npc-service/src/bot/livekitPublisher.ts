import type { NpcSpawnCommand } from '@meetropolis/shared';
import { logger } from '../index.js';

// Lazy imports for @livekit/rtc-node (may not be available in all environments)
let lkRtcNode: typeof import('@livekit/rtc-node') | null = null;
let lkServerSdk: typeof import('livekit-server-sdk') | null = null;

async function getLkRtcNode(): Promise<typeof import('@livekit/rtc-node')> {
  if (!lkRtcNode) lkRtcNode = await import('@livekit/rtc-node');
  return lkRtcNode;
}

async function getLkServerSdk(): Promise<typeof import('livekit-server-sdk')> {
  if (!lkServerSdk) lkServerSdk = await import('livekit-server-sdk');
  return lkServerSdk;
}

interface LivekitTrackHandle {
  stop?: () => void | Promise<void>;
}

export class LivekitPublisher {
  private command: NpcSpawnCommand;
  // Use import type for Room - lazily resolved at runtime
  private room: import('@livekit/rtc-node').Room | null = null;
  private connected = false;
  private activeTracks: LivekitTrackHandle[] = [];

  constructor(command: NpcSpawnCommand) {
    this.command = command;
  }

  async connect(): Promise<void> {
    const { npc, livekitUrl, livekitApiKey, livekitApiSecret, tenantSlug } = this.command;
    const identity = `npc-${npc.identity}`;
    const roomName = `${tenantSlug}:world`;

    try {
      const lk = await getLkRtcNode();
      const sdk = await getLkServerSdk();

      const at = new sdk.AccessToken(livekitApiKey, livekitApiSecret, { identity });
      at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: false });
      const token = await at.toJwt();

      this.room = new lk.Room();
      await this.room.connect(livekitUrl, token);
      this.connected = true;
      logger.info(`[LivekitPublisher ${identity}] Connected to room ${roomName}`);
    } catch (e) {
      logger.error({ err: e }, `[LivekitPublisher ${identity}] Connect failed`);
      throw e;
    }
  }

  async publishAudio(filePath: string, loop?: boolean): Promise<void> {
    if (!this.connected) await this.connect();
    const identity = this.command.npc.identity;
    logger.info(`[LivekitPublisher ${identity}] publishAudio: ${filePath} loop=${!!loop}`);
    // TODO: Implement audio frame pipeline with @livekit/rtc-node AudioSource
    // Full implementation requires FFmpeg pipeline
    logger.warn(`[LivekitPublisher ${identity}] Audio publishing not yet implemented (requires FFmpeg pipeline)`);
  }

  async publishVideo(filePath: string, loop?: boolean): Promise<void> {
    if (!this.connected) await this.connect();
    const identity = this.command.npc.identity;
    logger.info(`[LivekitPublisher ${identity}] publishVideo: ${filePath} loop=${!!loop}`);
    // TODO: Implement video frame pipeline
    logger.warn(`[LivekitPublisher ${identity}] Video publishing not yet implemented (requires FFmpeg pipeline)`);
  }

  async publishScreenshare(filePath: string, loop?: boolean): Promise<void> {
    if (!this.connected) await this.connect();
    const identity = this.command.npc.identity;
    logger.info(`[LivekitPublisher ${identity}] publishScreenshare: ${filePath} loop=${!!loop}`);
    // TODO: Implement screenshare pipeline (similar to video but as screen source)
    logger.warn(`[LivekitPublisher ${identity}] Screenshare publishing not yet implemented`);
  }

  async stopAllMedia(): Promise<void> {
    for (const track of this.activeTracks) {
      try {
        await track.stop?.();
      } catch { /* ignore track stop errors */ }
    }
    this.activeTracks = [];
  }

  async disconnect(): Promise<void> {
    await this.stopAllMedia();
    try {
      await this.room?.disconnect();
    } catch { /* room may already be disconnected */ }
    this.room = null;
    this.connected = false;
  }
}
