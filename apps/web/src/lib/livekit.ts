import { createLocalScreenTracks, Room } from 'livekit-client';

function normalizeLivekitUrl(input: string | undefined): string {
  const fallback = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? 'wss://localhost:7880' : 'ws://localhost:7880';
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
  useVideo: boolean;
}) {
  const res = await fetch(`${params.baseUrl}/livekit/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomName: params.roomName, identity: params.identity, name: params.identity })
  });
  const token = (await res.text()).trim();
  const room = new Room();
  const serverUrl = normalizeLivekitUrl(import.meta.env.VITE_LIVEKIT_URL);
  await room.connect(serverUrl, token);
  // WICHTIG: keine lokalen Audio/Video-Tracks automatisch erstellen/publizieren.
  return room;
}

export async function startScreenshare(room: Room) {
  const tracks = await createLocalScreenTracks({});
  for (const t of tracks) await room.localParticipant.publishTrack(t);
}
