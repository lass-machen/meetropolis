import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { AccessToken } from 'livekit-server-sdk';
import { Room, RoomEvent, TrackKind, TrackSource, VideoStream } from '@livekit/rtc-node';
import type { RemoteParticipant, RemoteTrack, RemoteTrackPublication } from '@livekit/rtc-node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NpcSpawnCommand } from '@meetropolis/shared';
import { LivekitPublisher } from './livekitPublisher.js';

// importing index.js would start the HTTP server; only the logger is replaced, LiveKit and ffmpeg stay real.
vi.mock('../index.js', () => ({ logger: pino({ level: 'silent' }) }));

const LIVEKIT_URL = process.env.LIVEKIT_URL ?? '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? '';

let tmpDir = '';
let clipPath = '';
let notVideoPath = '';
const publishers: LivekitPublisher[] = [];
const receiverRooms: Room[] = [];

function makeCommand(): { command: NpcSpawnCommand; roomName: string; participantIdentity: string } {
  const suffix = randomUUID();
  const tenantSlug = `test-${suffix}`;
  const identity = `test-npc-${suffix}`;
  const command = {
    npc: { identity },
    livekitUrl: LIVEKIT_URL,
    livekitApiKey: LIVEKIT_API_KEY,
    livekitApiSecret: LIVEKIT_API_SECRET,
    tenantSlug,
  } as unknown as NpcSpawnCommand;
  return { command, roomName: `${tenantSlug}:world`, participantIdentity: `npc-${identity}` };
}

async function connectReceiver(roomName: string): Promise<Room> {
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: `receiver-${randomUUID()}`,
  });
  token.addGrant({ room: roomName, roomJoin: true, canSubscribe: true, canPublish: false });
  const room = new Room();
  await room.connect(LIVEKIT_URL, await token.toJwt(), { autoSubscribe: true });
  receiverRooms.push(room);
  return room;
}

async function waitForVideoTrack(
  room: Room,
  participantIdentity: string,
  timeoutMs = 20000,
): Promise<TrackSource | undefined> {
  const publication = await new Promise<RemoteTrackPublication>((resolve, reject) => {
    const timer = setTimeout(() => {
      room.off(RoomEvent.TrackSubscribed, onTrack);
      reject(new Error(`timed out waiting for a video track of ${participantIdentity}`));
    }, timeoutMs);
    const onTrack = (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant): void => {
      if (participant.identity !== participantIdentity) return;
      if (track.kind !== TrackKind.KIND_VIDEO) return;
      clearTimeout(timer);
      room.off(RoomEvent.TrackSubscribed, onTrack);
      resolve(pub);
    };
    room.on(RoomEvent.TrackSubscribed, onTrack);
  });
  const source = publication.source;
  const track = publication.track;
  if (!track) throw new Error(`video publication of ${participantIdentity} has no track`);
  const stream = new VideoStream(track);
  const reader = stream.getReader();
  const first = await reader.read();
  if (first.done || !first.value)
    throw new Error(`video stream of ${participantIdentity} ended before the first frame`);
  await reader.cancel();
  return source;
}

describe.skipIf(!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET)(
  'LivekitPublisher video against a real LiveKit server',
  () => {
    beforeAll(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'npc-video-test-'));
      clipPath = join(tmpDir, 'clip.mp4');
      notVideoPath = join(tmpDir, 'not-video.txt');
      await writeFile(notVideoPath, 'not a video');
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          'ffmpeg',
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-f',
            'lavfi',
            '-i',
            'testsrc=size=320x240:rate=30:duration=2',
            '-pix_fmt',
            'yuv420p',
            clipPath,
          ],
          { stdio: 'ignore' },
        );
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg exited with code ${code}`));
        });
      });
    }, 60000);

    afterEach(async () => {
      for (const room of receiverRooms.splice(0)) {
        try {
          await room.disconnect();
        } catch {
          // Already gone; cleanup must not fail the test.
        }
      }
      for (const publisher of publishers.splice(0)) {
        try {
          await publisher.disconnect();
        } catch {
          // Already gone; cleanup must not fail the test.
        }
      }
    });

    afterAll(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('publishes camera video until stopAllMedia stops it', async () => {
      const { command, roomName, participantIdentity } = makeCommand();
      const publisher = new LivekitPublisher(command);
      publishers.push(publisher);
      const room = await connectReceiver(roomName);
      const publishing = publisher.publishVideo(clipPath, true);
      const source = await waitForVideoTrack(room, participantIdentity);
      expect(source).toBe(TrackSource.SOURCE_CAMERA);
      await publisher.stopAllMedia();
      await expect(publishing).resolves.toBeUndefined();
    }, 60000);

    it('publishes screenshare video until stopAllMedia stops it', async () => {
      const { command, roomName, participantIdentity } = makeCommand();
      const publisher = new LivekitPublisher(command);
      publishers.push(publisher);
      const room = await connectReceiver(roomName);
      const publishing = publisher.publishScreenshare(clipPath, true);
      const source = await waitForVideoTrack(room, participantIdentity);
      expect(source).toBe(TrackSource.SOURCE_SCREENSHARE);
      await publisher.stopAllMedia();
      await expect(publishing).resolves.toBeUndefined();
    }, 60000);

    it('resolves on its own when the clip ends without loop', async () => {
      const { command } = makeCommand();
      const publisher = new LivekitPublisher(command);
      publishers.push(publisher);
      await publisher.publishVideo(clipPath);
    }, 60000);

    it('rejects for a file that is not a video', async () => {
      const { command } = makeCommand();
      const publisher = new LivekitPublisher(command);
      publishers.push(publisher);
      await expect(publisher.publishVideo(notVideoPath)).rejects.toThrow();
    }, 60000);
  },
);
