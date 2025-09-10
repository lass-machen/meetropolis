import { createLocalScreenTracks, Room } from 'livekit-client';
import { logger } from './logger';

function normalizeLivekitUrl(input: string | undefined): string {
  const host = (typeof window !== 'undefined') ? window.location.hostname : 'localhost';
  const scheme = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? 'wss' : 'ws';
  const fallback = `${scheme}://${host}:7880`;
  if (!input) return fallback;
  const u = input.trim();
  if (u.startsWith('ws://') || u.startsWith('wss://')) return u;
  if (u.startsWith('http://')) return 'ws://' + u.slice('http://'.length);
  if (u.startsWith('https://')) return 'wss://' + u.slice('https://'.length);
  return u; // assume caller provided correct host without protocol
}

export async function joinLivekitRoom(params: {
  baseUrl: string;
  tokenEndpoint: string;
  roomName: string;
  identity: string;
  displayName?: string;
  useVideo: boolean;
}) {
  const res = await fetch(`${params.baseUrl}/livekit/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ roomName: params.roomName, identity: params.identity, name: params.displayName || params.identity })
  });
  if (!res.ok) {
    throw new Error('LiveKit Token konnte nicht geholt werden');
  }
  const token = (await res.text()).trim();
  const room = new Room();
  const serverUrl = normalizeLivekitUrl(import.meta.env.VITE_LIVEKIT_URL);
  
  await room.connect(serverUrl, token, {
    autoSubscribe: true,
    video: params.useVideo,
    audio: true,
    // Adaptive Stream aktivieren: LiveKit liefert nur sicht-/benötigte Layer
    // @ts-ignore: SDK akzeptiert boolean oder Settings-Objekt
    adaptiveStream: true,
    // Nutzt Simulcast effizienter (deaktiviert ungenutzte Layer)
    // @ts-ignore
    dynacast: true,
    // Publishing-Defaults (werden vom SDK teils ignoriert, dienen als Hint)
    // @ts-ignore
    publishDefaults: {
      // Kamera moderat, Screenshare hoch
      // @ts-ignore
      videoEncoding: { maxBitrate: 1_200_000, maxFramerate: 30 },
      // @ts-ignore
      screenShareEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
      // @ts-ignore
      simulcast: true,
    },
    // Zusätzliche Bitraten-Hints (falls von Version unterstützt)
    // @ts-ignore optional in SDK
    maxAudioBitrate: 64_000,
    // @ts-ignore optional in SDK
    maxVideoBitrate: 2_000_000
  } as any);
  // WICHTIG: keine lokalen Audio/Video-Tracks automatisch erstellen/publizieren.
  return room;
}

export async function startScreenshare(room: Room) {
  const tracks = await createLocalScreenTracks({
    video: {
      frameRate: 30,
      resolution: { width: 1920, height: 1080 },
    } as any,
    audio: true,
  } as any);
  for (const t of tracks) await room.localParticipant.publishTrack(t);
}
