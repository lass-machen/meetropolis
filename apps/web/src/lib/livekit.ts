import { createLocalScreenTracks, Room } from 'livekit-client';
import { logger } from './logger';
import { buildCorrelationHeaders } from './avLog';

export type JoinLivekitRoomParams = {
  baseUrl: string;
  tokenEndpoint: string;
  roomName: string;
  identity: string;
  displayName?: string;
  useVideo: boolean;
};

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
  // 4) Tauri/WKWebView: Do NOT force relay by default.
  //    WKWebView masks host candidates as mDNS (.local) but STUN still generates
  //    server-reflexive candidates with real IPs. Direct ICE via STUN works fine.
  //    Force relay only breaks things when TURN port config is mismatched
  //    (e.g. LiveKit advertises port 5349 but Traefik only routes on 443).
  //    The fallback in joinLivekitRoom() retries with relay if direct ICE fails.
  // 5) Heuristic: cellular / constrained networks often require TURN/relay
  try {
    const conn: any = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    const type = (conn?.type || '').toString().toLowerCase();
    const eff = (conn?.effectiveType || '').toString().toLowerCase();
    if (type === 'cellular') return true;
    if (eff.includes('slow-2g') || eff.includes('2g')) return true;
  } catch {}
  return false;
}

async function fetchLivekitToken(params: JoinLivekitRoomParams): Promise<string> {
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
  return (await res.text()).trim();
}

function isDesktopEnvironment(): boolean {
  try {
    const anyWin = window as any;
    return !!(anyWin.__MEETROPOLIS_API_BASE__ || anyWin.desktop?.apiBase);
  } catch {
    return false;
  }
}

async function fetchLivekitUrlFromApi(baseUrl: string): Promise<string | undefined> {
  try {
    const urlRes = await fetch(`${baseUrl}/livekit/url`, { credentials: 'include' });
    if (!urlRes.ok) return undefined;
    const data = await urlRes.json();
    if (data.url && typeof data.url === 'string') {
      return normalizeLivekitUrl(data.url);
    }
  } catch {}
  return undefined;
}

function readLivekitUrlFromEnv(): string | undefined {
  const envUrl = (import.meta as any).env?.VITE_LIVEKIT_URL;
  if (typeof envUrl === 'string' && envUrl) {
    return normalizeLivekitUrl(envUrl);
  }
  return undefined;
}

function computeFallbackLivekitUrl(): string {
  const host = (typeof window !== 'undefined') ? window.location.hostname : 'localhost';
  const scheme = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? 'wss' : 'ws';
  return `${scheme}://${host}:7880`;
}

async function resolveLivekitServerUrl(params: JoinLivekitRoomParams): Promise<string> {
  let serverUrl: string | undefined;

  // In Tauri, always fetch from API since VITE_LIVEKIT_URL is not available at runtime
  if (isDesktopEnvironment()) {
    serverUrl = await fetchLivekitUrlFromApi(params.baseUrl);
  }

  // Fallback to env variable for browser builds
  if (!serverUrl) {
    serverUrl = readLivekitUrlFromEnv();
  }

  // If still no URL or localhost, try fetching from API
  if (!serverUrl || serverUrl.includes('localhost')) {
    serverUrl = (await fetchLivekitUrlFromApi(params.baseUrl)) ?? serverUrl;
  }

  // Final fallback
  if (!serverUrl) {
    serverUrl = computeFallbackLivekitUrl();
  }

  return serverUrl;
}

async function connectLivekitRoom(args: {
  serverUrl: string;
  token: string;
  roomName: string;
  identity: string;
  forceRelay: boolean;
}): Promise<Room> {
  const room = new Room();
  try {
    logger.debug('[AV][debug] livekit.connecting', {
      serverUrl: args.serverUrl,
      roomName: args.roomName,
      identity: args.identity,
      forceRelay: args.forceRelay,
    });
  } catch {}

  // Build rtcConfig for ICE gathering
  // Detect local/LAN development: localhost, loopback, .local mDNS, private IP ranges
  const isLocalDev = /localhost|127\.0\.0\.1|\.local[:/]|^wss?:\/\/10\.|^wss?:\/\/192\.168\.|^wss?:\/\/172\.(1[6-9]|2\d|3[01])\./.test(args.serverUrl);

  const rtcConfig: RTCConfiguration = {
    // For local Docker development, DON'T use STUN servers
    // STUN causes browser to advertise its public IP which Docker can't reach
    // For production, use STUN to help with NAT traversal
    iceServers: isLocalDev ? [] : [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
    ...(args.forceRelay ? { iceTransportPolicy: 'relay' as RTCIceTransportPolicy } : {}),
  };

  // Log ICE config for debugging (only in dev)
  if (isLocalDev) {
    console.log('[LiveKit] ICE config for local dev:', { iceServers: rtcConfig.iceServers, isLocalDev });
  }

  await room.connect(args.serverUrl, args.token, {
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
    // RTC configuration with STUN servers
    rtcConfig,
  } as any);

  try {
    const anyRoom: any = room as any;
    const roomID = anyRoom?.roomID || anyRoom?.sid || anyRoom?.name;
    const localSid = anyRoom?.localParticipant?.sid;
    const nRem = Array.from((anyRoom?.remoteParticipants?.values?.() || []) as any).length;
    logger.debug('[AV][debug] livekit.connected', { roomID, localSid, nRemote: nRem, forceRelay: args.forceRelay });
  } catch {}

  // Absicherung: explizit Auto-Disconnect bei Page-Leave deaktivieren (falls vom SDK unterstützt)
  try { (room as any).setDisconnectOnPageLeave?.(false); } catch {}
  return room;
}

function logRelayRetry(error: unknown): void {
  try {
    logger.warn('[AV] livekit.connect retry with relay', { error: String(error) });
  } catch {}
}

function logRelayRetryFailed(error: unknown): void {
  try {
    logger.warn('[AV] livekit.connect relay retry failed', { error: String(error) });
  } catch {}
}

export async function joinLivekitRoom(params: JoinLivekitRoomParams): Promise<Room> {
  const token = await fetchLivekitToken(params);
  const serverUrl = await resolveLivekitServerUrl(params);

  const initialForceRelay = shouldForceRelay();
  try {
    // WICHTIG: keine lokalen Audio/Video-Tracks automatisch erstellen/publizieren.
    return await connectLivekitRoom({
      serverUrl,
      token,
      roomName: params.roomName,
      identity: params.identity,
      forceRelay: initialForceRelay,
    });
  } catch (error) {
    // Fallback: wenn Direct-ICE scheitert (Hotspot/VPN/Corporate-NAT), einmal mit TURN/Relay probieren
    if (!initialForceRelay) {
      logRelayRetry(error);
      try {
        return await connectLivekitRoom({
          serverUrl,
          token,
          roomName: params.roomName,
          identity: params.identity,
          forceRelay: true,
        });
      } catch (retryError) {
        logRelayRetryFailed(retryError);
        throw retryError;
      }
    }
    throw error;
  }
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
