import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';

const SAMPLE_RATE = 48_000;
const NUM_CHANNELS = 1;
const FRAME_DURATION_MS = 20;
const SAMPLES_PER_FRAME = Math.floor((SAMPLE_RATE * FRAME_DURATION_MS) / 1000); // 960

export async function spawnLivekitBot(opts: {
  apiBase: string;
  livekitUrl: string;
  roomName: string;
  identity: string;
}): Promise<{ stop: () => Promise<void> }> {
  // Generate server-side token (same flow as before, livekit-server-sdk stays).
  const apiKey = process.env.LIVEKIT_API_KEY || 'devkey';
  const apiSecret = process.env.LIVEKIT_API_SECRET || 'secret';
  const at = new AccessToken(apiKey, apiSecret, { identity: opts.identity });
  at.addGrant({
    room: opts.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });
  const token = await at.toJwt();

  const t0 = Date.now();
  const room = new Room();
  await room.connect(opts.livekitUrl, token, {
    autoSubscribe: false,
    dynacast: false,
  });
  const timeToConnectMs = Date.now() - t0;

  // Publish silence audio so the bot looks like a normal participant with a mic track.
  const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS);
  const audioTrack = LocalAudioTrack.createAudioTrack('loadtest-audio', audioSource);
  const publishOptions = new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE });
  const publication = await room.localParticipant!.publishTrack(audioTrack, publishOptions);
  const trackSid = publication.sid;

  // Periodically push silent frames (zero PCM) — keeps the publication alive
  // and provides realistic upstream traffic for SFU stress testing.
  let alive = true;
  const silenceFramePromise = (async () => {
    const silentSamples = new Int16Array(SAMPLES_PER_FRAME * NUM_CHANNELS); // initialised to 0
    while (alive) {
      try {
        const frame = new AudioFrame(silentSamples, SAMPLE_RATE, NUM_CHANNELS, SAMPLES_PER_FRAME);
        await audioSource.captureFrame(frame);
      } catch {
        // If capture fails (e.g. track was unpublished), stop.
        break;
      }
    }
  })();

  let samples = 0;
  let lastInboundAudio = 0;
  let lastRemoteParticipants = 0;

  // Periodically subscribe to a few participants (simulate proximity) and
  // sample basic metrics. rtc-node exposes `room.remoteParticipants` as a Map
  // and each RemoteTrackPublication has `setSubscribed(boolean)`.
  const samplerPromise = (async () => {
    while (alive) {
      try {
        const parts: RemoteParticipant[] = Array.from(room.remoteParticipants.values());
        const firstN = parts.slice(0, 5);
        for (const p of firstN) {
          const pubs: RemoteTrackPublication[] = Array.from(p.trackPublications.values());
          for (const pub of pubs) {
            if (pub.kind === TrackKind.KIND_AUDIO) {
              try {
                pub.setSubscribed(true);
              } catch {
                /* ignore */
              }
            }
          }
        }
        // Basic metrics
        lastRemoteParticipants = parts.length;
        let inboundAudio = 0;
        for (const p of parts) {
          const pubs: RemoteTrackPublication[] = Array.from(p.trackPublications.values());
          for (const pub of pubs) {
            if (pub.kind === TrackKind.KIND_AUDIO) inboundAudio++;
          }
        }
        lastInboundAudio = inboundAudio;
        samples++;
      } catch {
        // ignore sampling errors — they should not abort the bot
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();

  return {
    async stop() {
      alive = false;
      // Wait for background loops so we don't capture frames after disconnect.
      await Promise.allSettled([silenceFramePromise, samplerPromise]);
      try {
        if (trackSid) {
          await room.localParticipant?.unpublishTrack(trackSid);
        }
      } catch {
        /* ignore */
      }
      try {
        await audioSource.close();
      } catch {
        /* ignore */
      }
      try {
        await room.disconnect();
      } catch {
        /* ignore */
      }
      // Emit summary line for ingestion
      try {
        console.log(
          JSON.stringify({
            event: 'livekit_bot_summary',
            identity: opts.identity,
            room: opts.roomName,
            timeToConnectMs,
            samples,
            lastRemoteParticipants,
            lastInboundAudio,
          }),
        );
      } catch {
        /* ignore */
      }
    },
  };
}
