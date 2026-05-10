import { createLocalScreenTracks, Room } from 'livekit-client';
import { logger } from './logger';
import { buildCorrelationHeaders } from './avLog';
import { readTimeoutMs } from './runtimeConfig';

export type JoinLivekitRoomParams = {
  baseUrl: string;
  tokenEndpoint: string;
  roomName: string;
  identity: string;
  displayName?: string;
  useVideo: boolean;
};

function normalizeLivekitUrl(input: string | undefined): string {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const scheme = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
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
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const envRaw = env.VITE_AV_FORCE_RELAY ?? env.VITE_LK_FORCE_RELAY;
  if (typeof envRaw === 'string') {
    const v = envRaw.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  // 2) URL overrides (runtime): ?relay=1 / ?lkrelay=1 / ?forceRelay=1
  try {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const qp = new URLSearchParams(search);
    const relayParam = (qp.get('relay') || qp.get('lkrelay') || qp.get('forceRelay') || '').toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(relayParam)) return true;
  } catch {}
  // 3) LocalStorage override (runtime persistent)
  try {
    const ls = typeof window !== 'undefined' ? window.localStorage : null;
    const lsVal = (ls?.getItem('av.forceRelay') || ls?.getItem('lk.forceRelay') || '').toLowerCase();
    if (lsVal === 'true') return true;
  } catch {}
  // 4) Tauri/WKWebView: Do NOT force relay by default.
  // 5) Heuristic: cellular / constrained networks often require TURN/relay
  try {
    const nav = navigator as Navigator & {
      connection?: { type?: string; effectiveType?: string };
      mozConnection?: { type?: string; effectiveType?: string };
      webkitConnection?: { type?: string; effectiveType?: string };
    };
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
    const type = (conn?.type || '').toLowerCase();
    const eff = (conn?.effectiveType || '').toLowerCase();
    if (type === 'cellular') return true;
    if (eff.includes('slow-2g') || eff.includes('2g')) return true;
  } catch {}
  return false;
}

async function fetchLivekitToken(params: JoinLivekitRoomParams): Promise<string> {
  const timeoutMs = readTimeoutMs('VITE_LIVEKIT_TOKEN_TIMEOUT_MS', 10_000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${params.baseUrl}/livekit/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildCorrelationHeaders({ identity: params.identity, roomName: params.roomName }),
      },
      credentials: 'include',
      body: JSON.stringify({
        roomName: params.roomName,
        identity: params.identity,
        name: params.displayName || params.identity,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error('LiveKit Token konnte nicht geholt werden');
    }
    return (await res.text()).trim();
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new Error('livekit_token_timeout');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function isDesktopEnvironment(): boolean {
  try {
    const w = window as Window & { __MEETROPOLIS_API_BASE__?: string; desktop?: { apiBase?: string } };
    return !!(w.__MEETROPOLIS_API_BASE__ || w.desktop?.apiBase);
  } catch {
    return false;
  }
}

async function fetchLivekitUrlFromApi(baseUrl: string): Promise<string | undefined> {
  const timeoutMs = readTimeoutMs('VITE_LIVEKIT_URL_TIMEOUT_MS', 5_000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const urlRes = await fetch(`${baseUrl}/livekit/url`, {
      credentials: 'include',
      signal: controller.signal,
    });
    if (!urlRes.ok) return undefined;
    const data = (await urlRes.json()) as { url?: unknown };
    if (data.url && typeof data.url === 'string') {
      return normalizeLivekitUrl(data.url);
    }
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      // Timeout – let resolveLivekitServerUrl fall back gracefully
      return undefined;
    }
  } finally {
    clearTimeout(timeoutId);
  }
  return undefined;
}

function readLivekitUrlFromEnv(): string | undefined {
  const env = (import.meta as unknown as { env?: { VITE_LIVEKIT_URL?: string } }).env;
  const envUrl = env?.VITE_LIVEKIT_URL;
  if (typeof envUrl === 'string' && envUrl) {
    return normalizeLivekitUrl(envUrl);
  }
  return undefined;
}

function computeFallbackLivekitUrl(): string {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const scheme = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
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

interface LivekitConnectOptions {
  autoSubscribe: boolean;
  video: boolean;
  audio: boolean;
  disconnectOnPageLeave: boolean;
  adaptiveStream: boolean;
  dynacast: boolean;
  publishDefaults: {
    dtx: boolean;
    simulcast: boolean;
    videoEncoding: { maxBitrate: number; maxFramerate: number };
    screenShareEncoding: { maxBitrate: number; maxFramerate: number };
  };
  audioCaptureDefaults: {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
  };
  rtcConfig?: RTCConfiguration;
}

function buildConnectOptions(forceRelay: boolean): LivekitConnectOptions {
  // rtcConfig: Only pass when forceRelay is needed.
  // The LiveKit server provides its own ICE/STUN/TURN config via signaling.
  // Passing a client-side rtcConfig overrides the server config and breaks
  // PeerConnection establishment with newer LiveKit server versions (v1.8+).
  const rtcConfig: RTCConfiguration | undefined = forceRelay
    ? { iceTransportPolicy: 'relay' as RTCIceTransportPolicy }
    : undefined;

  return {
    autoSubscribe: false,
    // Lokale Tracks werden nicht automatisch erzeugt; Remote-Subscribe erfolgt gezielt
    video: false,
    audio: false,
    // Nicht automatisch trennen bei pagehide/visibilitychange (wir managen Resume selbst)
    disconnectOnPageLeave: false,
    // Adaptive Stream: liefert nur benötigte Layer
    adaptiveStream: true,
    // Simulcast/Dynacast für effiziente Layer-Nutzung
    dynacast: true,
    // Publishing-Defaults inkl. DTX für Sprache
    publishDefaults: {
      dtx: true,
      simulcast: true,
      videoEncoding: { maxBitrate: 1_200_000, maxFramerate: 30 },
      screenShareEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
    },
    // Audio-Capture Defaults (für Browser-Track-Erzeugung)
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    // RTC config only when relay is forced (server provides ICE config via signaling)
    ...(rtcConfig ? { rtcConfig } : {}),
  };
}

async function awaitConnectWithTimeout(room: Room, connectPromise: Promise<void>): Promise<void> {
  const timeoutMs = readTimeoutMs('VITE_LIVEKIT_CONNECT_TIMEOUT_MS', 10_000);
  const TIMEOUT_SENTINEL = Symbol('livekit_connect_timeout');
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timeoutId = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
  });

  try {
    const result = await Promise.race([connectPromise, timeoutPromise]);
    if (result === TIMEOUT_SENTINEL) {
      try {
        await room.disconnect(true);
      } catch {}
      throw new Error('livekit_connect_timeout');
    }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function logConnected(room: Room, forceRelay: boolean): void {
  try {
    const r = room as Room & { roomID?: string; sid?: string };
    const roomID = r.roomID || r.sid || r.name;
    const localSid = r.localParticipant?.sid;
    const nRem = Array.from(r.remoteParticipants?.values?.() || []).length;
    logger.debug('[AV][debug] livekit.connected', { roomID, localSid, nRemote: nRem, forceRelay });
  } catch {}
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

  const connectPromise = room.connect(args.serverUrl, args.token, buildConnectOptions(args.forceRelay));
  await awaitConnectWithTimeout(room, connectPromise);
  logConnected(room, args.forceRelay);

  // Absicherung: explizit Auto-Disconnect bei Page-Leave deaktivieren (falls vom SDK unterstützt)
  try {
    (room as Room & { setDisconnectOnPageLeave?: (v: boolean) => void }).setDisconnectOnPageLeave?.(false);
  } catch {}
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
  const videoOpts = { frameRate: 30, resolution: { width: 1920, height: 1080 } };
  const tracks = await createLocalScreenTracks({ video: videoOpts, audio: true } as unknown as Parameters<
    typeof createLocalScreenTracks
  >[0]);
  for (const t of tracks) await room.localParticipant.publishTrack(t);
}
