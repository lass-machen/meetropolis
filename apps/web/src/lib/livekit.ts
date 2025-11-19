import { createLocalScreenTracks, Room } from 'livekit-client';
import { logger } from './logger';
import { buildCorrelationHeaders } from './avLog';

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

function shouldForceRelay(): boolean {
  // 1) Build-time env flags take precedence when explicitly set
  const env: any = (import.meta as any).env || {};
  const envRaw = (env?.VITE_AV_FORCE_RELAY ?? env?.VITE_LK_FORCE_RELAY);
  if (typeof envRaw === 'string') {
    const v = envRaw.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  // 2) URL overrides (runtime): ?relay=1 / ?lkrelay=1 / ?forceRelay=1
  try {
    const search = (typeof window !== 'undefined') ? window.location.search : '';
    const qp = new URLSearchParams(search);
    const relayParam = (qp.get('relay') || qp.get('lkrelay') || qp.get('forceRelay') || '').toLowerCase();
    if (['1','true','yes','on'].includes(relayParam)) return true;
  } catch {}
  // 3) LocalStorage override (runtime persistent)
  try {
    const ls = (typeof window !== 'undefined') ? window.localStorage : null;
    const lsVal = (ls?.getItem('av.forceRelay') || ls?.getItem('lk.forceRelay') || '').toLowerCase();
    if (lsVal === 'true') return true;
  } catch {}
  // 4) Heuristic: cellular / constrained networks often require TURN/relay
  try {
    const conn: any = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    const type = (conn?.type || '').toString().toLowerCase();
    const eff = (conn?.effectiveType || '').toString().toLowerCase();
    if (type === 'cellular') return true;
    if (eff.includes('slow-2g') || eff.includes('2g')) return true;
  } catch {}
  return false;
}

export async function joinLivekitRoom(params: {
  baseUrl: string;
  tokenEndpoint: string;
  roomName: string;
  identity: string;
  displayName?: string;
  useVideo: boolean;
}) {
  // 1. Fetch Token
  const res = await fetch(`${params.baseUrl}/livekit/token`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      ...buildCorrelationHeaders({ identity: params.identity, roomName: params.roomName }),
    },
    credentials: 'include',
    body: JSON.stringify({ roomName: params.roomName, identity: params.identity, name: params.displayName || params.identity })
  });
  if (!res.ok) {
    throw new Error('LiveKit Token konnte nicht geholt werden');
  }
  const token = (await res.text()).trim();

  // 2. Determine Server URL
  let serverUrl = normalizeLivekitUrl((import.meta as any).env?.VITE_LIVEKIT_URL);
  // If fallback/localhost or empty, try fetching from API
  if (!serverUrl || serverUrl.includes('localhost')) {
    try {
      const urlRes = await fetch(`${params.baseUrl}/livekit/url`);
      if (urlRes.ok) {
        const data = await urlRes.json();
        if (data.url) {
          serverUrl = normalizeLivekitUrl(data.url);
        }
      }
    } catch {}
  }

  const room = new Room();
  try { logger.debug('[AV][debug] livekit.connecting', { serverUrl, roomName: params.roomName, identity: params.identity }); } catch {}
  const forceRelay = shouldForceRelay();
  
  await room.connect(serverUrl, token, {
    autoSubscribe: false,
    // Lokale Tracks werden nicht automatisch erzeugt; Remote-Subscribe erfolgt gezielt
    video: false,
    audio: false,
    // Nicht automatisch trennen bei pagehide/visibilitychange (wir managen Resume selbst)
    // @ts-ignore
    disconnectOnPageLeave: false,
    // Adaptive Stream: liefert nur benötigte Layer
    // @ts-ignore
    adaptiveStream: true,
    // Simulcast/Dynacast für effiziente Layer-Nutzung
    // @ts-ignore
    dynacast: true,
    // Publishing-Defaults inkl. DTX für Sprache
    // @ts-ignore
    publishDefaults: {
      // @ts-ignore
      dtx: true,
      // @ts-ignore
      simulcast: true,
      // @ts-ignore
      videoEncoding: { maxBitrate: 1_200_000, maxFramerate: 30 },
      // @ts-ignore
      screenShareEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
    },
    // Audio-Capture Defaults (für Browser-Track-Erzeugung)
    // @ts-ignore
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    // Optional für harte NATs (Feature-Flag-basiert aktivieren)
    ...(forceRelay ? { rtcConfig: { iceTransportPolicy: 'relay' } as any } : {}),
  } as any);
  try {
    const anyRoom: any = room as any;
    const roomID = anyRoom?.roomID || anyRoom?.sid || anyRoom?.name;
    const localSid = anyRoom?.localParticipant?.sid;
    const nRem = Array.from((anyRoom?.remoteParticipants?.values?.() || []) as any).length;
    logger.debug('[AV][debug] livekit.connected', { roomID, localSid, nRemote: nRem });
  } catch {}
  // Absicherung: explizit Auto-Disconnect bei Page-Leave deaktivieren (falls vom SDK unterstützt)
  try { (room as any).setDisconnectOnPageLeave?.(false); } catch {}
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
