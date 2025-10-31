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
  const room = new Room();
  const serverUrl = normalizeLivekitUrl((import.meta as any).env?.VITE_LIVEKIT_URL);
  const forceRelay = ((import.meta as any).env?.VITE_AV_FORCE_RELAY || (import.meta as any).env?.VITE_LK_FORCE_RELAY) === 'true';
  // Warten auf erste Nutzergeste, um AudioContext-Warnung beim Laden zu vermeiden
  const waitForUserGesture = async () => {
    try {
      const ua: any = (navigator as any).userActivation;
      if (ua && ua.isActive) return; // Bereits durch Nutzergeste aktiv
    } catch {}
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; cleanup(); resolve(); } };
      const handler = () => finish();
      const opts: AddEventListenerOptions | boolean = { capture: true, once: true };
      const events: (keyof WindowEventMap)[] = ['pointerdown', 'click', 'keydown', 'touchstart'];
      const cleanup = () => events.forEach(ev => window.removeEventListener(ev, handler as any, true));
      events.forEach(ev => window.addEventListener(ev, handler as any, opts));
    });
  };
  await waitForUserGesture();
  
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
