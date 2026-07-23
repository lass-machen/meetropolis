import type { NpcSpawnCommand } from '@meetropolis/shared';
import { logger } from '../index.js';
import { parseWavFrames, transcodeToPcm } from './mediaPlayer.js';

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
      // canSubscribe must be true: the Rust SDK's wait_pc_connection() waits for
      // the subscriber PeerConnection to reach "connected" state. With canSubscribe: false,
      // the server never sends a subscriber offer, causing a 15s timeout.
      at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
      const token = await at.toJwt();

      this.room = new lk.Room();
      logger.info(`[LivekitPublisher ${identity}] Connecting to ${livekitUrl} room=${roomName}...`);
      await this.room.connect(livekitUrl, token, {
        autoSubscribe: false,
        dynacast: false,
      });
      this.connected = true;
      logger.info(`[LivekitPublisher ${identity}] Connected to room ${roomName}`);
    } catch (e) {
      logger.error({ err: e }, `[LivekitPublisher ${identity}] Connect failed`);
      throw e;
    }
  }

  async publishAudio(filePath: string, loop?: boolean, mimeType?: string): Promise<void> {
    if (!this.connected) await this.connect();
    const identity = this.command.npc.identity;
    const lk = await getLkRtcNode();

    const SAMPLE_RATE = 48000;
    const NUM_CHANNELS = 1;
    const FRAME_DURATION_MS = 20;
    const SAMPLES_PER_FRAME = Math.floor((SAMPLE_RATE * FRAME_DURATION_MS) / 1000); // 960

    // Create AudioSource and LocalAudioTrack
    const audioSource = new lk.AudioSource(SAMPLE_RATE, NUM_CHANNELS);
    const track = lk.LocalAudioTrack.createAudioTrack('npc-audio', audioSource);

    // Publish as microphone source
    const publishOptions = new lk.TrackPublishOptions({
      source: lk.TrackSource.SOURCE_MICROPHONE,
    });
    const publication = await this.room!.localParticipant!.publishTrack(track, publishOptions);
    const trackSid = publication.sid;
    logger.info(`[LivekitPublisher ${identity}] Published audio track (sid=${trackSid})`);

    // Cancellation mechanism for stopAllMedia()
    let stopped = false;
    const trackHandle: LivekitTrackHandle = {
      stop: async () => {
        stopped = true;
        try {
          if (trackSid) {
            await this.room?.localParticipant?.unpublishTrack(trackSid);
          }
        } catch {
          /* ignore */
        }
        try {
          await audioSource.close();
        } catch {
          /* ignore */
        }
      },
    };
    this.activeTracks.push(trackHandle);

    try {
      const isWav = !mimeType || mimeType === 'audio/wav' || mimeType === 'audio/wave' || filePath.endsWith('.wav');

      do {
        if (isWav) {
          for await (const frame of parseWavFrames(filePath, FRAME_DURATION_MS)) {
            if (stopped) break;
            const lkFrame = new lk.AudioFrame(frame.data, frame.sampleRate, frame.channels, frame.samplesPerChannel);
            await audioSource.captureFrame(lkFrame);
          }
        } else {
          // FFmpeg transcode for MP3, OGG, etc.
          const pcmStream = transcodeToPcm(filePath, SAMPLE_RATE, NUM_CHANNELS);
          let remainder = Buffer.alloc(0);
          const bytesPerFrame = SAMPLES_PER_FRAME * NUM_CHANNELS * 2; // 16-bit = 2 bytes per sample

          for await (const chunk of pcmStream) {
            if (stopped) break;
            remainder = Buffer.concat([remainder, chunk]);

            while (remainder.length >= bytesPerFrame && !stopped) {
              const frameBuffer = remainder.subarray(0, bytesPerFrame);
              remainder = remainder.subarray(bytesPerFrame);
              const samples = new Int16Array(
                frameBuffer.buffer,
                frameBuffer.byteOffset,
                SAMPLES_PER_FRAME * NUM_CHANNELS,
              );
              const lkFrame = new lk.AudioFrame(samples, SAMPLE_RATE, NUM_CHANNELS, SAMPLES_PER_FRAME);
              await audioSource.captureFrame(lkFrame);
            }
          }
        }
      } while (loop && !stopped);
    } catch (e) {
      logger.error({ err: e }, `[LivekitPublisher ${identity}] Audio playback error`);
    }

    // Cleanup after playback completes
    if (!stopped) {
      try {
        if (trackSid) {
          await this.room?.localParticipant?.unpublishTrack(trackSid);
        }
      } catch {
        /* ignore */
      }
      try {
        await audioSource.close();
      } catch {
        /* ignore */
      }
    }
    const idx = this.activeTracks.indexOf(trackHandle);
    if (idx >= 0) this.activeTracks.splice(idx, 1);
  }

  async publishVideo(filePath: string, loop?: boolean, _mimeType?: string): Promise<void> {
    if (!this.connected) await this.connect();
    const identity = this.command.npc.identity;
    logger.info(`[LivekitPublisher ${identity}] publishVideo: ${filePath} loop=${!!loop}`);
    // TODO: Implement video frame pipeline
    logger.warn(`[LivekitPublisher ${identity}] Video publishing not yet implemented (requires FFmpeg pipeline)`);
  }

  async publishScreenshare(filePath: string, loop?: boolean, _mimeType?: string): Promise<void> {
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
      } catch {
        /* ignore track stop errors */
      }
    }
    this.activeTracks = [];
  }

  async disconnect(): Promise<void> {
    await this.stopAllMedia();
    try {
      await this.room?.disconnect();
    } catch {
      /* room may already be disconnected */
    }
    this.room = null;
    this.connected = false;
  }
}
