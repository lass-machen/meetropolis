import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  type RemoteParticipant,
} from '@livekit/rtc-node';
import { ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import { apiHttpBase, authHeaders, readResponseJson } from './session.js';

const SAMPLE_RATE = 48_000;
const NUM_CHANNELS = 1;
const FRAME_DURATION_MS = 20;
const SAMPLES_PER_FRAME = Math.floor((SAMPLE_RATE * FRAME_DURATION_MS) / 1000);
const PARTICIPANT_FIELD = 'identity';

export type LivekitBotOptions = {
  apiBase: string;
  tenant: string;
  token: string;
  roomName: string;
};

type LivekitRun = {
  alive: boolean;
  samples: number;
  lastInboundAudio: number;
  lastRemoteParticipants: number;
};

type ConnectedRoom = {
  room: Room;
  audioSource: AudioSource;
  trackSid: string | undefined;
  timeToConnectMs: number;
};

export async function spawnLivekitBot(opts: LivekitBotOptions): Promise<{ stop: () => Promise<void> }> {
  const userId = subjectFromSessionToken(opts.token);
  const url = await resolveLivekitUrl(opts.apiBase, opts.tenant, opts.token);
  const participantToken = await requestParticipantToken(opts, userId);
  const connected = await connectRoom(url, participantToken);
  const run: LivekitRun = { alive: true, samples: 0, lastInboundAudio: 0, lastRemoteParticipants: 0 };
  const silence = pushSilence(connected.audioSource, run);
  const sampler = sampleRoom(connected.room, run);
  return {
    stop: () => finishLivekitBot(connected, run, silence, sampler, opts.roomName, userId),
  };
}

function subjectFromSessionToken(token: string): string {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('session token has no subject');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new Error('session token has no subject');
  }
  if (typeof parsed !== 'object' || parsed === null || !('sub' in parsed)) {
    throw new Error('session token has no subject');
  }
  const subject = parsed.sub;
  if (typeof subject !== 'string' || subject.length === 0) throw new Error('session token has no subject');
  return subject;
}

async function resolveLivekitUrl(apiBase: string, tenant: string, token: string): Promise<string> {
  const fromEnv = process.env.LIVEKIT_URL;
  if (fromEnv && fromEnv.trim()) return normalizeLivekitUrl(fromEnv);
  const response = await fetch(`${apiHttpBase(apiBase)}/livekit/url`, {
    method: 'GET',
    headers: authHeaders(tenant, token),
  });
  if (!response.ok) throw new Error(`livekit url request failed with status ${response.status}`);
  const url = readUrlField(await readResponseJson(response));
  if (!url) throw new Error('livekit url missing');
  return normalizeLivekitUrl(url);
}

function readUrlField(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('url' in body)) return null;
  const url = body.url;
  return typeof url === 'string' && url.trim() ? url : null;
}

function normalizeLivekitUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) return trimmed;
  if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}`;
  if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}`;
  return trimmed;
}

async function requestParticipantToken(opts: LivekitBotOptions, userId: string): Promise<string> {
  const response = await fetch(`${apiHttpBase(opts.apiBase)}/livekit/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(opts.tenant, opts.token),
    },
    body: JSON.stringify({
      roomName: opts.roomName,
      name: userId,
      zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
      [PARTICIPANT_FIELD]: userId,
    }),
  });
  if (!response.ok) throw new Error(`livekit token request failed with status ${response.status}`);
  const participantToken = (await response.text()).trim();
  if (!participantToken) throw new Error(`livekit token request failed with status ${response.status}`);
  return participantToken;
}

async function connectRoom(url: string, participantToken: string): Promise<ConnectedRoom> {
  const started = Date.now();
  const room = new Room();
  await room.connect(url, participantToken, { autoSubscribe: false, dynacast: false });
  const publisher = room.localParticipant;
  if (!publisher) throw new Error('livekit room has no local participant');
  const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS);
  const audioTrack = LocalAudioTrack.createAudioTrack('loadtest-audio', audioSource);
  const publishOptions = new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE });
  const publication = await publisher.publishTrack(audioTrack, publishOptions);
  return { room, audioSource, trackSid: publication.sid, timeToConnectMs: Date.now() - started };
}

async function pushSilence(audioSource: AudioSource, run: LivekitRun): Promise<void> {
  const silentSamples = new Int16Array(SAMPLES_PER_FRAME * NUM_CHANNELS);
  while (run.alive) {
    try {
      const frame = new AudioFrame(silentSamples, SAMPLE_RATE, NUM_CHANNELS, SAMPLES_PER_FRAME);
      await audioSource.captureFrame(frame);
    } catch {
      break;
    }
  }
}

async function sampleRoom(room: Room, run: LivekitRun): Promise<void> {
  while (run.alive) {
    try {
      const participants = Array.from(room.remoteParticipants.values());
      subscribeFirstAudio(participants);
      run.lastRemoteParticipants = participants.length;
      run.lastInboundAudio = countAudioTracks(participants);
      run.samples += 1;
    } catch {
      // Sampling must not abort the bot.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
  }
}

function subscribeFirstAudio(participants: RemoteParticipant[]): void {
  for (const participant of participants.slice(0, 5)) {
    for (const publication of participant.trackPublications.values()) {
      if (publication.kind !== TrackKind.KIND_AUDIO) continue;
      try {
        publication.setSubscribed(true);
      } catch {
        // A publication can disappear between the snapshot and the subscribe call.
      }
    }
  }
}

function countAudioTracks(participants: RemoteParticipant[]): number {
  let inboundAudio = 0;
  for (const participant of participants) {
    for (const publication of participant.trackPublications.values()) {
      if (publication.kind === TrackKind.KIND_AUDIO) inboundAudio += 1;
    }
  }
  return inboundAudio;
}

async function finishLivekitBot(
  connected: ConnectedRoom,
  run: LivekitRun,
  silence: Promise<void>,
  sampler: Promise<void>,
  roomName: string,
  userId: string,
): Promise<void> {
  run.alive = false;
  await Promise.allSettled([silence, sampler]);
  await releaseRoom(connected);
  console.log(
    JSON.stringify({
      event: 'livekit_bot_summary',
      userId,
      room: roomName,
      timeToConnectMs: connected.timeToConnectMs,
      samples: run.samples,
      lastRemoteParticipants: run.lastRemoteParticipants,
      lastInboundAudio: run.lastInboundAudio,
    }),
  );
}

async function releaseRoom(connected: ConnectedRoom): Promise<void> {
  try {
    if (connected.trackSid) await connected.room.localParticipant?.unpublishTrack(connected.trackSid);
  } catch {
    // Unpublish is best-effort during shutdown.
  }
  try {
    await connected.audioSource.close();
  } catch {
    // The source may already be closed.
  }
  try {
    await connected.room.disconnect();
  } catch {
    // Disconnect is best-effort during shutdown.
  }
}
