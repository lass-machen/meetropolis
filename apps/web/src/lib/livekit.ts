import { createLocalScreenTracks, Room } from 'livekit-client';

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
  // console.log('[LiveKit] Requesting token for:', { roomName: params.roomName, identity: params.identity, name: params.displayName || params.identity });
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
  // console.log('[LiveKit] Connecting to server:', serverUrl);
  
  // Add connection event listeners
  room.on('connected', () => {
    // console.log('[LiveKit] Connected to room:', room.name);
    // console.log('[LiveKit] Local participant:', room.localParticipant?.identity);
    // console.log('[LiveKit] Remote participants:', room.participants ? Array.from(room.participants.keys()) : []);
  });
  
  room.on('participantConnected', (participant) => {
    // console.log('[LiveKit] Participant connected:', participant.identity);
  });
  
  room.on('trackSubscribed', (track, publication, participant) => {
    // console.log('[LiveKit] Track subscribed:', {
      kind: track.kind,
      source: track.source,
      participant: participant.identity,
      participantSid: participant.sid,
      publicationSource: publication.source,
      isScreenShare: track.source === 'screen_share'
    });
  });
  
  room.on('trackUnsubscribed', (track, publication, participant) => {
    // console.log('[LiveKit] Track unsubscribed:', {
      kind: track.kind,
      source: track.source,
      participant: participant.identity
    });
  });
  
  room.on('activeSpeakersChanged', (speakers) => {
    // console.log('[LiveKit] Active speakers changed:', speakers.map(s => s.identity));
  });
  
  room.on('trackPublished', (publication, participant) => {
    // console.log('[LiveKit] Track published:', {
      source: publication.source,
      kind: publication.kind,
      participant: participant.identity,
      participantSid: participant.sid,
      isLocal: participant === room.localParticipant,
      isScreenShare: publication.source === 'screen_share',
      track: !!publication.track
    });
  });
  
  room.on('localTrackPublished', (publication, participant) => {
    // console.log('[LiveKit] LOCAL Track published:', {
      source: publication.source,
      kind: publication.kind,
      participant: participant.identity,
      isScreenShare: publication.source === 'screen_share'
    });
  });
  
  await room.connect(serverUrl, token, {
    autoSubscribe: true,
    publishDefaults: {
      simulcast: false,
      videoCodec: 'vp8'
    }
  });
  // WICHTIG: keine lokalen Audio/Video-Tracks automatisch erstellen/publizieren.
  return room;
}

export async function startScreenshare(room: Room) {
  const tracks = await createLocalScreenTracks({});
  for (const t of tracks) await room.localParticipant.publishTrack(t);
}
