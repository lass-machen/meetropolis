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
    autoSubscribe: true
  });
  // WICHTIG: keine lokalen Audio/Video-Tracks automatisch erstellen/publizieren.
  return room;
}

export async function startScreenshare(room: Room) {
  const tracks = await createLocalScreenTracks({});
  for (const t of tracks) await room.localParticipant.publishTrack(t);
}
