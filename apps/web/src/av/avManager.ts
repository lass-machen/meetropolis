const SIMPLE = (import.meta as any).env?.VITE_AV_SIMPLE === 'true';
const ALLOW_RECONNECT = (import.meta as any).env?.VITE_AV_RECONNECT !== 'false';
import { Room, createLocalScreenTracks } from 'livekit-client';
import { joinLivekitRoom } from '../lib/livekit';
import { avLog } from '../lib/avLog';
import { onBubbleMembersUpdate } from '../lib/avEvents';
import { startStatsLoopImpl } from './core/stats';
import { applyDefaultRemoteQualityImpl, onConnectionQualityChangedImpl } from './core/quality';
import { AVController } from './controller/avController';
import { buildAudioPipeline } from './audio/buildAudioPipeline';
import { useAvSettingsStore } from '../state/avSettings';
import { applySubscriptions as applySubscriptionsCtl, ensureSubscribeAllAudio as ensureSubscribeAllAudioCtl } from './controller/subscriptions';

export type AVDevices = {
  microphones: { deviceId: string; label: string }[];
  cameras: { deviceId: string; label: string }[];
};

export class AVManager {
  private current: Room | undefined;
  private currentName: string | null = null;
  private readonly baseUrl: string;
  private readonly identity: string;
  private readonly displayName: string;
  private readonly useVideo: boolean;
  private controller: AVController | null = null;
  private isConnecting = false;
  private connectSeq = 0;
  private isDisconnecting = false;
  private preferredMic?: string;
  private preferredCam?: string;
  private pendingMic = false;
  private pendingCam = false;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private statsTimer: any = null;
  private unsubscribeBus: (() => void) | null = null;
  private lastProximityAt = 0;
  private fallbackSubTimer: any = null;
  private lastFallbackChosenKey: string | null = null;
  // Audio-Unlock State
  private audioUnlockHandlersAttached = false;
  private removeAudioUnlockHandlers: (() => void) | null = null;
  // Local camera quality adaptation (removed unused fields)
  private avState: 'idle' | 'connecting' | 'connected' | 'publishing' | 'subscribed' | 'error' | 'reconnecting' | 'closed' = 'idle';
  private sharePending = false;
  private remoteQualityTuningDisabled = ((import.meta as any).env?.VITE_AV_DISABLE_REMOTE_QUALITY === 'true');
  private lastMicDesired = false;
  private lastCamDesired = false;
  // removed unused field lastApplyDefaultRemoteQualityAt
  // Debounce/Dedupe für Bubble-Updates
  private desiredIds: string[] = [];
  private bubbleDebounceTimer: any = null;
  // removed unused field lastDesiredIdsKey
  private lastDesiredIdsKeyRef = { current: null as string | null };
  private lastDesiredSubs = new Map<string, boolean>();
  // Event-Wiring / Idempotenz (removed unused fields)
  // Page-Leave Guard
  private pageLeaving = false;
  private removePageLeaveGuards: (() => void) | null = null;
  // Event-Handler Verwaltung
  private roomHandlersCleanup: (() => void) | null = null;
  // Active Speaker Cache
  private activeSpeakerIds: string[] = [];
  // Config
  private readonly maxVideoSubs: number = Math.max(0, Number(((import.meta as any).env?.VITE_AV_MAX_VIDEO_SUBS) ?? 6));
  private readonly bubbleAttenuation: number = (() => {
    const db = Number(((import.meta as any).env?.VITE_AV_BUBBLE_ATTENUATION_DB) ?? -12);
    // grobe Umrechnung: 20*log10(gain) = dB → gain = 10^(dB/20)
    const gain = Math.max(0, Math.min(1, Math.pow(10, db / 20)));
    return isFinite(gain) ? gain : 0.25;
  })();
  private readonly videoRetentionMs: number = Math.max(0, Number(((import.meta as any).env?.VITE_AV_VIDEO_RETENTION_MS) ?? 8000));
  private lastVideoOnAt = new Map<string, number>();
  // DND
  private dnd = false;
  private unsubscribeAvSettings: (() => void) | null = null;
  private settingsRepubTimer: any = null;
  // Console-Debug Steuerung (Original-Funktion merken, um togglen zu können)
  private originalConsoleDebug: ((...args: any[]) => void) | null = null;

  constructor(opts: { baseUrl: string; identity: string; displayName?: string; useVideo: boolean }) {
    this.baseUrl = opts.baseUrl;
    this.identity = opts.identity;
    this.displayName = opts.displayName || opts.identity;
    this.useVideo = opts.useVideo;
    // Controller initialisieren (schlanke Brücke)
    this.controller = new AVController({ baseUrl: this.baseUrl, identity: this.identity, displayName: this.displayName, useVideo: this.useVideo });
    // Install global debug overlay toggle once
    try {
      const w: any = window as any;
      if (!w.__avDebugToggleInstalled) {
        w.__avDebugToggleInstalled = true;
        window.addEventListener('keydown', (e) => {
          try {
            if ((e.altKey && (e.key.toLowerCase?.() === 'd')) || (e.ctrlKey && e.shiftKey && e.key.toLowerCase?.() === 'd')) {
              const ww: any = window as any;
              ww.__avDebugOn = !ww.__avDebugOn;
              if (!ww.__avDebugOn) {
                const el = document.getElementById('av-debug-hud');
                if (el) el.remove();
              }
              try { this.updateConsoleDebugHook(); } catch {}
            }
          } catch {}
        }, true);
      }
    } catch {}
    // Initiales Setzen des console.debug Hooks entsprechend Env/Flag
    try { this.updateConsoleDebugHook(); } catch {}

    // Netzereignisse: bei Offline/Online automatisch State setzen & Rejoin versuchen
    try {
      window.addEventListener('offline', () => {
        try { this.setState('reconnecting'); } catch {}
      });
      window.addEventListener('online', () => {
        try {
          if (this.currentName && !this.isRoomConnected()) {
            void this.switchTo(this.currentName).catch(() => {});
          }
        } catch {}
      });
      // Page-Leave Guard
      const setLeaving = () => { this.pageLeaving = true; };
      window.addEventListener('pagehide', setLeaving);
      window.addEventListener('beforeunload', setLeaving);
    } catch {}
    // Auf AV-Settings reagieren (sanftes Re-Publish des Mic-Tracks, falls aktiv)
    try {
      this.unsubscribeAvSettings = useAvSettingsStore.subscribe((_state, _prev) => {
        try { if (this.settingsRepubTimer) clearTimeout(this.settingsRepubTimer); } catch {}
        this.settingsRepubTimer = setTimeout(async () => {
          this.settingsRepubTimer = null;
          const room = this.current;
          if (!room) return;
          const pubs = Array.from(room.localParticipant.trackPublications.values());
          const micPub: any = (pubs as any[]).find((pub: any) => {
            const src = (pub as any).source ?? (pub as any)?.track?.source;
            const kind = (pub as any).kind ?? (pub as any)?.track?.kind;
            return (src === 'microphone' || src === 0 || src === 2 || kind === 'audio') && !!(pub as any).track;
          });
          if (!micPub) return; // Mic ist aus – Änderungen greifen beim nächsten Einschalten
          const currentTrack: any = micPub.track;
          const oldMst: any = currentTrack?.mediaStreamTrack || currentTrack;

          const settings = useAvSettingsStore.getState().settings;
          const isApple = (() => { try { const ua = (navigator as any)?.userAgent || ''; return /Macintosh|Mac OS X|iPhone|iPad/i.test(ua); } catch { return false; } })();
          const supportsNs = (() => { try { const c = (navigator as any)?.mediaDevices?.getSupportedConstraints?.(); return !!(c && c.noiseSuppression); } catch { return false; } })();

          try {
            let newMst: MediaStreamTrack;
            if (isApple && supportsNs) {
              const audio: any = {
                echoCancellation: settings.echoCancellation,
                noiseSuppression: true,
                autoGainControl: settings.autoGainControl,
                channelCount: settings.channelCount,
              };
              if (this.preferredMic) audio.deviceId = this.preferredMic;
              const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false } as any);
              newMst = stream.getAudioTracks()[0];
              try { if ('contentHint' in newMst) (newMst as any).contentHint = 'speech'; } catch {}
            } else {
              const audio: any = {
                echoCancellation: settings.echoCancellation,
                noiseSuppression: false,
                autoGainControl: settings.autoGainControl,
                channelCount: settings.channelCount,
              };
              if (this.preferredMic) audio.deviceId = this.preferredMic;
              const rawStream = await navigator.mediaDevices.getUserMedia({ audio, video: false } as any);
              const rawMst = rawStream.getAudioTracks()[0];
              const { wrapTrackWithVoiceIsolation } = await import('./audio/voiceIsolation');
              newMst = await wrapTrackWithVoiceIsolation(rawMst);
            }
            // Nahtlos ersetzen statt Mute-Flip
            if (typeof currentTrack?.replaceTrack === 'function') {
              await currentTrack.replaceTrack(newMst as any);
              try { oldMst?.stop?.(); } catch {}
            } else {
              // Fallback: minimaler Flip, falls replaceTrack nicht verfügbar
              try { await this.setMicrophoneEnabled(false); } catch {}
              try { await this.setMicrophoneEnabled(true); } catch {}
            }
          } catch {
            // Letzter Fallback: alter Mechanismus
            try { await this.setMicrophoneEnabled(false); } catch {}
            try { await this.setMicrophoneEnabled(true); } catch {}
          }
        }, 250);
      });
    } catch {}
    // Page-Leave-Guards
    try {
      const onLeave = () => { this.pageLeaving = true; };
      const handler = onLeave as any;
      window.addEventListener('pagehide', handler, { capture: true } as any);
      window.addEventListener('beforeunload', handler, { capture: true } as any);
      document.addEventListener('visibilitychange', () => {
        try {
          if (document.visibilityState === 'hidden') {
            this.pageLeaving = true;
          } else if (document.visibilityState === 'visible') {
            // Sofortige Wiederaufnahme der Subscriptions/Publishes bei Rückkehr
            try { (this.current as any)?.startAudio?.(); } catch {}
            try { this.ensureSubscribeAllAudio(64); } catch {}
            try { this.applyDesiredSubscriptions(); } catch {}
            try { void this.restoreDesiredTracks(); } catch {}
          }
        } catch {}
      }, { capture: true } as any);
      window.addEventListener('focus', () => {
        try { (this.current as any)?.startAudio?.(); } catch {}
        try { this.ensureSubscribeAllAudio(64); } catch {}
        try { this.applyDesiredSubscriptions(); } catch {}
        try { void this.restoreDesiredTracks(); } catch {}
      }, { capture: true } as any);
      window.addEventListener('pageshow', () => {
        try { (this.current as any)?.startAudio?.(); } catch {}
        try { this.ensureSubscribeAllAudio(64); } catch {}
        try { this.applyDesiredSubscriptions(); } catch {}
        try { void this.restoreDesiredTracks(); } catch {}
      }, { capture: true } as any);
      this.removePageLeaveGuards = () => {
        try { window.removeEventListener('pagehide', handler, true); } catch {}
        try { window.removeEventListener('beforeunload', handler, true); } catch {}
      };
    } catch {}
  }

  private setState(next: typeof this.avState) {
    if (this.avState === next) return;
    const prev = this.avState;
    this.avState = next;
    try { this.controller?.setState(next as any); } catch {}
    try { avLog('debug', 'av.state', { prev, next }, { identity: this.identity, roomName: this.currentName || undefined as any }); } catch {}
  }

  private isRoomConnected(): boolean {
    const room: any = this.current as any;
    if (!room) return false;
    const state = room.connectionState || room.state;
    if (state === 'connected' || state === 2) return true;
    // Test-/Fallback: wenn ein Room mit localParticipant existiert, als verbunden betrachten
    try { if (room.localParticipant) return true; } catch {}
    return false;
  }

  // Aktiviert/Deaktiviert console.debug abhängig von Env/Debug-Flag, um Prod-Konsole nicht zu fluten
  private updateConsoleDebugHook(): void {
    try {
      const w: any = window as any;
      const env: any = (import.meta as any).env || {};
      const enableDebug = !!env.DEV || env.VITE_AV_DEBUG === 'true' || !!w.__avDebugOn;
      if (!this.originalConsoleDebug) {
        try { this.originalConsoleDebug = console.debug.bind(console); } catch {}
      }
      (console as any).debug = enableDebug && this.originalConsoleDebug ? (this.originalConsoleDebug as any) : (() => {}) as any;
    } catch {}
  }

  private isSignalOpen(): boolean {
    try {
      const ws: any = (this.current as any)?.engine?.signalClient?.ws;
      if (ws && typeof ws.readyState === 'number') return ws.readyState === 1; // OPEN
    } catch {}
    // Fallback auf Verbindungszustand
    return this.isRoomConnected();
  }

  private getSubscribed(pub: any): boolean {
    try {
      if (typeof pub?.isSubscribed === 'boolean') return pub.isSubscribed;
      if (typeof pub?.subscribed === 'boolean') return pub.subscribed;
      // Heuristik: wenn Track existiert, ist meist subscribed
      return !!(pub?.track);
    } catch { return false; }
  }

  private ensureSubscribed(pub: any, should: boolean): void {
    try {
      const current = this.getSubscribed(pub);
      if (current === should) return;
      if (!this.isSignalOpen()) return;
      pub.setSubscribed?.(should);
    } catch {}
  }

  get isConnected(): boolean {
    return this.isRoomConnected();
  }

  async switchTo(roomName: string) {
    if (this.currentName === roomName) return;
    const name = roomName || 'world';
    const seq = ++this.connectSeq;
    if (!SIMPLE && this.isConnecting) return; // Debounce parallele Verbindungsversuche
    this.isConnecting = true;
    try {
      this.setState('connecting');
      avLog('info', 'av.switchTo.start', { targetRoom: name }, { identity: this.identity, roomName: name });
      await this.leave();
      if (seq !== this.connectSeq) return; // verworfen
      const room = await joinLivekitRoom({
        baseUrl: this.baseUrl,
        tokenEndpoint: '/livekit/token',
        roomName: name,
        identity: this.identity,
        displayName: this.displayName,
        useVideo: this.useVideo,
      });
      if (seq !== this.connectSeq) { try { await room.disconnect(); } catch {} return; }
      this.current = room;
      // Apply audio publish defaults from settings (DTX/FEC)
      try {
        const s = useAvSettingsStore.getState().settings;
        (room as any).setTrackPublishDefaults?.({ dtx: !!s.useDtx, red: !!s.useFec });
      } catch {}
      try { this.controller?.setRoom(room); } catch {}
      this.currentName = name;
      this.reconnectAttempts = 0;
      this.wireRoomEvents();
      this.startStatsLoop();
      avLog('info', 'av.switchTo.connected', { connected: true }, { identity: this.identity, roomName: name });
      try { console.debug('[AV][debug] connected', { room: name, identity: this.identity }); } catch {}
      this.setState('connected');
      // Audio-Wiedergabe erst per Nutzerinteraktion freischalten
      this.attachAudioUnlockHandlers();
      // Sofort versuchen, ggf. ausstehende lokale Publishes zu aktivieren (deterministischer für Tests und UI)
      try {
        if (this.pendingMic) { await this.setMicrophoneEnabled(true); this.pendingMic = false; }
      } catch {}
      try {
        if (this.pendingCam) { await this.setCameraEnabled(true); this.pendingCam = false; }
      } catch {}
      // Sofortige Erst-Subscriptions für kleine Gruppen (vermeidet "stumm" nach Join)
      try {
        setTimeout(() => {
          try {
            console.debug('[AV][debug] initial subscribe apply');
            this.ensureSubscribeAllAudio(64);
            this.applyDesiredSubscriptions();
          } catch {}
        }, 200);
      } catch {}
      if (!SIMPLE) {
        const connectedBefore = Date.now();
        await this.waitForConnected(room).catch(()=>{});
        const waited = Date.now() - connectedBefore;
        const anyRoom2: any = room as any;
        const state = anyRoom2?.connectionState || anyRoom2?.state;
        if (waited > 4500 && !(state === 'connected' || state === 2)) {
          this.setState('error');
        }
      }
    } finally {
      this.isConnecting = false;
    }
    // Tracks aktivieren
    if (SIMPLE) {
      try { 
        if (this.pendingMic) {
          await this.setMicrophoneEnabled(true);
          this.pendingMic = false;
        }
      } catch {}
      try { 
        if (this.pendingCam) {
          await this.setCameraEnabled(true);
          this.pendingCam = false;
        }
      } catch {}
    } else {
      setTimeout(async () => {
        if (!this.current) return;
        try { 
          if (this.pendingMic) {
            await this.setMicrophoneEnabled(true);
            this.pendingMic = false;
          }
        } catch {}
        try { 
          if (this.pendingCam) {
            await this.setCameraEnabled(true);
            this.pendingCam = false;
          }
        } catch {}
      }, 0);
    }
  }

  async leave() {
    // Merke aktuellen Track-Status, um ihn nach Rejoin wieder zu aktivieren
    const prevName = this.currentName;
    let wasMicOn = false;
    let wasCamOn = false;
    try {
      const r = this.current;
      if (r) {
        const pubs = Array.from(r.localParticipant.trackPublications.values());
        for (const pub of pubs) {
          const src = (pub as any).source ?? (pub as any)?.track?.source;
          const kind = (pub as any).kind ?? (pub as any)?.track?.kind;
          const isMic = src === 'microphone' || src === 0 || kind === 'audio';
          const isCam = src === 'camera' || src === 1 || (kind === 'video' && src !== 'screen_share');
          if (isMic && (pub as any).track) wasMicOn = true;
          if (isCam && (pub as any).track) wasCamOn = true;
        }
      }
    } catch {}

    if (this.current) {
      this.isDisconnecting = true;
      try { this.controller?.setDisconnecting(true); } catch {}
      try {
        // Vor Disconnect: Events vom Room lösen
        try { this.unwireRoomEvents(); } catch {}
        // Unpublish & stop lokale Tracks vor Disconnect, um sauberen Zustand zu garantieren
        const pubs = Array.from(this.current.localParticipant.trackPublications.values());
        for (const pub of pubs) {
          try { await this.current.localParticipant.unpublishTrack(pub.track!); } catch {}
          try { (pub.track as any)?.stop?.(); } catch {}
        }
      } catch {}
      try { await this.current.disconnect(); } catch {}
    }
    try { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); } catch {}
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    try { this.unsubscribeBus?.(); } catch {}
    this.unsubscribeBus = null;
    try { if (this.fallbackSubTimer) clearInterval(this.fallbackSubTimer); } catch {}
    this.fallbackSubTimer = null;
    try { if (this.statsTimer) clearInterval(this.statsTimer); } catch {}
    this.statsTimer = null;
    this.current = undefined;
    try { this.controller?.setRoom(undefined as any); } catch {}
    this.currentName = null;
    setTimeout(() => { this.isDisconnecting = false; }, 50);
    try { this.controller?.setDisconnecting(false); this.controller?.resetReconnect(); } catch {}
    this.setState('closed');
    try { this.removePageLeaveGuards?.(); } catch {}
    this.removePageLeaveGuards = null;
    try { this.unsubscribeAvSettings?.(); } catch {}
    this.unsubscribeAvSettings = null;

    // Setze Pending-Flags, damit sie nach Rejoin automatisch aktiviert werden
    if (wasMicOn) this.pendingMic = true;
    if (wasCamOn) this.pendingCam = true;
    avLog('info', 'av.leave', { wasMicOn, wasCamOn, prevRoom: prevName || null }, { identity: this.identity, roomName: prevName || undefined as any });
  }

  get activeRoom(): string | null {
    return this.currentName;
  }

  get room(): Room | undefined {
    return this.current;
  }

  setParticipantVolume(identity: string, volume: number) {
    const room = this.current;
    if (!room) return;
    try {
      const rAny: any = room as any;
      const participants = Array.from((rAny.remoteParticipants?.values() || []) as any);
      let p = participants.find((participant: any) => participant.identity === identity);
      // Fallback: allow lookup by map key if identity not present in fakes/tests
      if (!p && rAny.remoteParticipants && typeof rAny.remoteParticipants.get === 'function') {
        p = rAny.remoteParticipants.get(identity) || p;
      }
      if (!p) return;
      const pubs: any[] = Array.from(((p as any).trackPublications?.values?.() || []) as any);
      for (const pub of pubs) {
        const track: any = (pub as any).track;
        if (!track) continue;
        // LiveKit RemoteAudioTrack hat setVolume in v2
        if (typeof track.setVolume === 'function') {
          try { track.setVolume(Math.max(0, Math.min(1, volume))); } catch {}
        } else if ((track as any).mediaStreamTrack) {
          try { (track as any).mediaStreamTrack.volume = Math.max(0, Math.min(1, volume)); } catch {}
        }
      }
    } catch {}
  }

  private scheduleReconnect() {
    if (!this.currentName) return;
    if (this.isConnecting) return;
    const attempt = ++this.reconnectAttempts;
    const delay = Math.min(30000, 1000 * Math.pow(2, attempt - 1) + Math.random() * 500);
    try { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); } catch {}
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // Versuche in denselben Raum zurückzukehren
      const name = this.currentName!;
      void this.switchTo(name).catch(() => this.scheduleReconnect());
    }, delay);
  }

  private wireRoomEvents() {
    const room = this.current;
    if (!room) return;
    // Vorherige Handler bereinigen (idempotent)
    try { this.roomHandlersCleanup?.(); } catch {}
    this.roomHandlersCleanup = null;
    // Synchronous minimal fallback: ensure initial audio safety on subscribe immediately (avoids test race)
    try {
      const rAny: any = room as any;
      const earlySub = async (_track: any, pub: any, _participant: any) => {
        try { (pub as any)?.track?.setVolume?.(0); } catch {}
      };
      rAny.on?.('trackSubscribed', earlySub);
      // Remove on cleanup if no RoomEvent wiring is used
      const prevCleanup = this.roomHandlersCleanup;
      this.roomHandlersCleanup = () => { try { rAny.off?.('trackSubscribed', earlySub); } catch {}; try { prevCleanup?.(); } catch {} };
    } catch {}
    (async () => {
      try {
        const mod = await import('livekit-client');
        const RoomEvent = (mod as any).RoomEvent;
        if (RoomEvent) {
          const onReconnected = () => { this.reconnectAttempts = 0; try { avLog('info', 'livekit.reconnected', {}, { identity: this.identity, roomName: this.currentName || undefined as any }); } catch {}; try { this.ensureSubscribeAllAudio(64); this.applyDesiredSubscriptions(); } catch {}; void this.restoreDesiredTracks(); };
          const onDisconnected = () => { try { avLog('warn', 'livekit.disconnected', {}, { identity: this.identity, roomName: this.currentName || undefined as any }); } catch {}; this.setState('reconnecting'); try { this.controller?.setDisconnecting(this.isDisconnecting); this.controller?.setPageLeaving(this.pageLeaving); } catch {}; if (ALLOW_RECONNECT && this.controller?.shouldScheduleReconnect()) this.controller?.scheduleReconnect((n) => this.switchTo(n), () => this.currentName); else if (this.pageLeaving) { try { avLog('info', 'av.pageleave.blockReconnect', {}, { identity: this.identity, roomName: this.currentName || undefined as any }); } catch {} } };
          const onTrackPublished = (pub?: any, participant?: any) => { try {
            const src = (pub as any)?.source ?? (pub as any)?.track?.source;
            const kind = (pub as any)?.kind ?? (pub as any)?.track?.kind;
            avLog('debug', 'livekit.track_published', { kind, source: src, pid: participant?.sid }, { identity: this.identity, roomName: this.currentName || undefined as any });
            try { console.debug('[AV][debug] track_published', { kind, source: src, pid: participant?.sid }); } catch {}
            // Force-Abo: Audio, Kamera und Screenshare sofort
            if (kind === 'audio' || src === 'microphone' || src === 'screen_share' || src === 'camera') {
              try { (pub as any)?.setSubscribed?.(true); } catch {}
            }
            if (!this.remoteQualityTuningDisabled) this.applyDefaultRemoteQuality(); this.ensureSubscribeAllAudio(64);
          } catch {} };
          const onTrackSubscribed = async (_track: any, pub: any, participant: any) => { try {
            const src = (pub as any)?.source ?? (pub as any)?.track?.source;
            const kind = (pub as any)?.kind ?? (pub as any)?.track?.kind;
            avLog('debug', 'livekit.track_subscribed', { kind, source: src, pid: participant?.sid }, { identity: this.identity, roomName: this.currentName || undefined as any });
            try {
              const mutedPub = (pub as any)?.muted ?? (pub as any)?.isMuted;
              const isSub = this.getSubscribed(pub);
              const t: any = (pub as any)?.track;
              const tEnabled = (t?.isEnabled ?? t?.enabled ?? t?.mediaStreamTrack?.enabled);
              const tVol = (typeof t?.getVolume === 'function') ? t.getVolume() : (t as any)?.volume;
              const micEnabledRemote = (typeof (participant as any)?.isMicrophoneEnabled === 'function') ? (participant as any).isMicrophoneEnabled() : undefined;
              console.debug('[AV][debug] track_subscribed', { kind, source: src, pid: participant?.sid, mutedPub, isSub, tEnabled, tVol, micEnabledRemote });
            } catch {}
            if (pub && ((pub as any).kind === 'audio' || (pub as any)?.track?.kind === 'audio')) {
              try {
                const anyRoom: any = this.current as any;
                const before = !!(anyRoom?.canPlaybackAudio ?? false);
                const r = await (anyRoom?.startAudio?.());
                const after = !!(anyRoom?.canPlaybackAudio ?? false);
                console.debug('[AV][debug] startAudio on subscribe', { before, result: r, after });
              } catch (e) { try { console.warn('[AV][debug] startAudio error', e); } catch {} }
              try {
                const vol = 0; // sichere Initial-Lautstärke bis Bubble/Zonen greifen
                (pub as any)?.track?.setVolume?.(vol);
                console.debug('[AV][debug] setVolume on remote audio (initial safe)', { vol, dnd: this.dnd });
              } catch {}
              // Fallback-Attach: falls globaler Audio-Hook nicht greift
              try {
                const t: any = (pub as any).track;
                if (t && typeof document !== 'undefined') {
                  const el = document.createElement('audio');
                  el.autoplay = true; (el as any).playsInline = true; el.style.display = 'none';
                  // Element-Volume nicht künstlich absenken – Track-Volume steuert initial 0
                  try { el.muted = !!this.dnd; } catch {}
                  document.body.appendChild(el);
                  try {
                    console.debug('[AV][debug] audio_attach_attempt', { muted: el.muted, vol: el.volume, readyState: el.readyState });
                    el.addEventListener('error', (ev) => { try { console.warn('[AV][debug] audio_attach_error', ev); } catch {} }, { once: true } as any);
                    el.addEventListener('stalled', () => { try { console.warn('[AV][debug] audio_attach_stalled'); } catch {} }, { once: true } as any);
                    el.addEventListener('canplay', () => { try { console.debug('[AV][debug] audio_attach_canplay'); } catch {} }, { once: true } as any);
                    el.addEventListener('playing', () => { try { console.debug('[AV][debug] audio_attach_playing'); } catch {} }, { once: true } as any);
                    t.attach(el);
                    console.debug('[AV][debug] audio_attach_ok');
                  } catch (e) { try { console.warn('[AV][debug] audio_attach_failed', e); } catch {} }
                }
              } catch {}
            }
            if (pub && ((pub as any).kind === 'video' || (pub as any)?.track?.kind === 'video')) {
              try {
                const dbgOn = !!((window as any).__avDebugOn);
                if (dbgOn) {
                  const t: any = (pub as any).track;
                  if (t && typeof document !== 'undefined') {
                    let hud = document.getElementById('av-debug-hud');
                    if (!hud) {
                      hud = document.createElement('div');
                      hud.id = 'av-debug-hud'; hud.style.position = 'fixed'; hud.style.right = '8px'; hud.style.bottom = '8px'; hud.style.zIndex = '99999'; hud.style.display = 'flex'; hud.style.gap = '4px'; hud.style.flexWrap = 'wrap'; hud.style.maxWidth = '40vw';
                      document.body.appendChild(hud);
                    }
                    const el = document.createElement('video');
                    el.autoplay = true; (el as any).playsInline = true; el.muted = true; el.width = 160; el.height = 90; el.style.background = '#000'; el.style.border = '1px solid #0ff';
                    hud.appendChild(el);
                    try { t.attach(el); console.debug('[AV][debug] video_debug_attach_ok'); } catch (e) { try { console.warn('[AV][debug] video_debug_attach_failed', e); } catch {} }
                  }
                }
              } catch {}
            }
            if (!this.remoteQualityTuningDisabled) this.applyDefaultRemoteQuality();
            this.setState('subscribed');
            this.ensureSubscribeAllAudio(64);
          } catch {} };
          const onConnQuality = (participant: any, quality: any) => { try { this.onConnectionQualityChanged(participant, quality); } catch {} };
          
          const onParticipantConnected = (participant: any) => { try {
            const id = String(participant?.identity || '');
            try {
              const parts: any[] = Array.from(((room as any).remoteParticipants?.values?.() || []) as any);
              const dbg = parts.map((p: any) => ({ id: String(p.identity||''), pubs: Array.from((p.trackPublications?.values?.()||[]) as any).map((pub:any)=>({ kind: pub?.kind ?? pub?.track?.kind, src: pub?.source ?? pub?.track?.source })) }));
              console.debug('[AV][debug] participant.connected', { id, n: parts.length, dbg });
            } catch {}
            this.ensureSubscribeAllAudio(64);
            this.applyDesiredSubscriptions();
          } catch {} };
          const onParticipantDisconnected = (participant: any) => { try {
            const id = String(participant?.identity || '');
            try {
              const parts: any[] = Array.from(((room as any).remoteParticipants?.values?.() || []) as any);
              console.debug('[AV][debug] participant.disconnected', { id, n: parts.length });
            } catch {}
            this.applyDesiredSubscriptions();
          } catch {} };
          const onAudioPlayback = () => {
            const anyRoom: any = room as any;
            const can = !!(anyRoom.canPlaybackAudio ?? false);
            try { console.debug('[AV][debug] audioPlaybackStatusChanged', { canPlaybackAudio: can }); } catch {}
            if (can) { try { this.removeAudioUnlockHandlers?.(); } catch {}; this.removeAudioUnlockHandlers = null; }
          };
          const onActiveSpeakers = () => {
            try {
              const list: any[] = (room as any).activeSpeakers || [];
              this.activeSpeakerIds = list.map((p: any) => String(p.identity || '')).filter(Boolean);
              try { console.debug('[AV][debug] activeSpeakers', { ids: this.activeSpeakerIds }); } catch {}
              // Video-Fallback auf aktive Sprecher anwenden
              this.applyDesiredSubscriptions();
            } catch {}
          };
          room.on?.(RoomEvent.Reconnected, onReconnected);
          room.on?.(RoomEvent.Disconnected, onDisconnected);
          room.on?.(RoomEvent.TrackPublished, onTrackPublished);
          room.on?.(RoomEvent.TrackSubscribed, onTrackSubscribed);
          // Zusätzliche Events: Unsubscribe/Unpublish/Muted wollen wir aktiv beantworten
          try {
            room.on?.(RoomEvent.TrackUnsubscribed, (_track: any, _pub: any, _p: any) => { try { this.ensureSubscribeAllAudio(64); this.applyDesiredSubscriptions(); } catch {} });
          } catch {}
          try {
            room.on?.(RoomEvent.TrackUnpublished, (_pub: any, _p: any) => { try { this.ensureSubscribeAllAudio(64); this.applyDesiredSubscriptions(); } catch {} });
          } catch {}
          try {
            room.on?.(RoomEvent.TrackMuted, (_pub: any, _p: any) => { try { this.ensureSubscribeAllAudio(64); this.applyDesiredSubscriptions(); } catch {} });
            room.on?.(RoomEvent.TrackUnmuted, (_pub: any, _p: any) => { try { this.ensureSubscribeAllAudio(64); this.applyDesiredSubscriptions(); } catch {} });
          } catch {}
          room.on?.(RoomEvent.ConnectionQualityChanged, onConnQuality);
          room.on?.(RoomEvent.ParticipantConnected, onParticipantConnected);
          room.on?.(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
          room.on?.(RoomEvent.AudioPlaybackStatusChanged, onAudioPlayback);
          room.on?.(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);

          this.roomHandlersCleanup = () => {
            try { room.off?.(RoomEvent.Reconnected, onReconnected); } catch {}
            try { room.off?.(RoomEvent.Disconnected, onDisconnected); } catch {}
            try { room.off?.(RoomEvent.TrackPublished, onTrackPublished); } catch {}
            try { room.off?.(RoomEvent.TrackSubscribed, onTrackSubscribed); } catch {}
            try { room.off?.(RoomEvent.ConnectionQualityChanged, onConnQuality); } catch {}
            try { room.off?.(RoomEvent.ParticipantConnected, onParticipantConnected); } catch {}
            try { room.off?.(RoomEvent.ParticipantDisconnected, onParticipantDisconnected); } catch {}
            try { room.off?.(RoomEvent.AudioPlaybackStatusChanged, onAudioPlayback); } catch {}
            try { room.off?.(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers); } catch {}
          };
        } else {
          const r: any = room as any;
          const onReconnected = () => { this.reconnectAttempts = 0; try { avLog('info', 'livekit.reconnected', {}, { identity: this.identity, roomName: this.currentName || undefined as any }); } catch {}; try { this.ensureSubscribeAllAudio(64); this.applyDesiredSubscriptions(); } catch {}; void this.restoreDesiredTracks(); };
          const onDisconnected = () => { try { avLog('warn', 'livekit.disconnected', {}, { identity: this.identity, roomName: this.currentName || undefined as any }); } catch {}; this.setState('reconnecting'); try { this.controller?.setDisconnecting(this.isDisconnecting); this.controller?.setPageLeaving(this.pageLeaving); } catch {}; if (ALLOW_RECONNECT && this.controller?.shouldScheduleReconnect()) this.controller?.scheduleReconnect((n) => this.switchTo(n), () => this.currentName); else if (this.pageLeaving) { try { avLog('info', 'av.pageleave.blockReconnect', {}, { identity: this.identity, roomName: this.currentName || undefined as any }); } catch {} } };
          const onTrackPublished = (pub?: any, participant?: any) => { try {
            const src = (pub as any)?.source ?? (pub as any)?.track?.source;
            const kind = (pub as any)?.kind ?? (pub as any)?.track?.kind;
            avLog('debug', 'livekit.track_published', { kind, source: src, pid: participant?.sid }, { identity: this.identity, roomName: this.currentName || undefined as any });
            try { console.debug('[AV][debug] track_published', { kind, source: src, pid: participant?.sid }); } catch {}
            if (kind === 'audio' || src === 'microphone' || src === 'screen_share' || src === 'camera') {
              try { (pub as any)?.setSubscribed?.(true); } catch {}
            }
            if (!this.remoteQualityTuningDisabled) this.applyDefaultRemoteQuality(); this.ensureSubscribeAllAudio(64);
          } catch {} };
          const onTrackSubscribed = async (_track: any, pub: any, participant: any) => { try {
            const src = (pub as any)?.source ?? (pub as any)?.track?.source;
            const kind = (pub as any)?.kind ?? (pub as any)?.track?.kind;
            avLog('debug', 'livekit.track_subscribed', { kind, source: src, pid: participant?.sid }, { identity: this.identity, roomName: this.currentName || undefined as any });
            try {
              const mutedPub = (pub as any)?.muted ?? (pub as any)?.isMuted;
              const isSub = this.getSubscribed(pub);
              const t: any = (pub as any)?.track;
              const tEnabled = (t?.isEnabled ?? t?.enabled ?? t?.mediaStreamTrack?.enabled);
              const tVol = (typeof t?.getVolume === 'function') ? t.getVolume() : (t as any)?.volume;
              const micEnabledRemote = (typeof (participant as any)?.isMicrophoneEnabled === 'function') ? (participant as any).isMicrophoneEnabled() : undefined;
              console.debug('[AV][debug] track_subscribed', { kind, source: src, pid: participant?.sid, mutedPub, isSub, tEnabled, tVol, micEnabledRemote });
            } catch {}
            if (pub && ((pub as any).kind === 'audio' || (pub as any)?.track?.kind === 'audio')) {
              try {
                const rAny: any = this.current as any;
                const before = !!(rAny?.canPlaybackAudio ?? false);
                const r = await (rAny?.startAudio?.());
                const after = !!(rAny?.canPlaybackAudio ?? false);
                console.debug('[AV][debug] startAudio on subscribe', { before, result: r, after });
              } catch (e) { try { console.warn('[AV][debug] startAudio error', e); } catch {} }
              try {
                const vol = 0; // sichere Initial-Lautstärke bis Bubble/Zonen greifen
                (pub as any)?.track?.setVolume?.(vol);
                console.debug('[AV][debug] setVolume on remote audio (initial safe)', { vol, dnd: this.dnd });
              } catch {}
              try {
                const t: any = (pub as any).track;
                if (t && typeof document !== 'undefined') {
                  const el = document.createElement('audio');
                  el.autoplay = true; (el as any).playsInline = true; el.style.display = 'none';
                  try { el.muted = !!this.dnd; } catch {}
                  document.body.appendChild(el);
                  try {
                    console.debug('[AV][debug] audio_attach_attempt', { muted: el.muted, vol: el.volume, readyState: el.readyState });
                    el.addEventListener('error', (ev) => { try { console.warn('[AV][debug] audio_attach_error', ev); } catch {} }, { once: true } as any);
                    el.addEventListener('stalled', () => { try { console.warn('[AV][debug] audio_attach_stalled'); } catch {} }, { once: true } as any);
                    el.addEventListener('canplay', () => { try { console.debug('[AV][debug] audio_attach_canplay'); } catch {} }, { once: true } as any);
                    el.addEventListener('playing', () => { try { console.debug('[AV][debug] audio_attach_playing'); } catch {} }, { once: true } as any);
                    t.attach(el);
                    console.debug('[AV][debug] audio_attach_ok');
                  } catch (e) { try { console.warn('[AV][debug] audio_attach_failed', e); } catch {} }
                }
              } catch {}
            }
            if (pub && ((pub as any).kind === 'video' || (pub as any)?.track?.kind === 'video')) {
              try {
                const dbgOn = !!((window as any).__avDebugOn);
                if (dbgOn) {
                  const t: any = (pub as any).track;
                  if (t && typeof document !== 'undefined') {
                    let hud = document.getElementById('av-debug-hud');
                    if (!hud) {
                      hud = document.createElement('div');
                      hud.id = 'av-debug-hud'; hud.style.position = 'fixed'; hud.style.right = '8px'; hud.style.bottom = '8px'; hud.style.zIndex = '99999'; hud.style.display = 'flex'; hud.style.gap = '4px'; hud.style.flexWrap = 'wrap'; hud.style.maxWidth = '40vw';
                      document.body.appendChild(hud);
                    }
                    const el = document.createElement('video');
                    el.autoplay = true; (el as any).playsInline = true; el.muted = true; el.width = 160; el.height = 90; el.style.background = '#000'; el.style.border = '1px solid #0ff';
                    hud.appendChild(el);
                    try { t.attach(el); console.debug('[AV][debug] video_debug_attach_ok'); } catch (e) { try { console.warn('[AV][debug] video_debug_attach_failed', e); } catch {} }
                  }
                }
              } catch {}
            }
            if (!this.remoteQualityTuningDisabled) this.applyDefaultRemoteQuality();
            this.setState('subscribed');
            this.ensureSubscribeAllAudio(64);
          } catch {} };
          const onConnQuality = (participant: any, quality: any) => { try { this.onConnectionQualityChanged(participant, quality); } catch {} };
          const onAudioPlayback = () => {
            const can = !!(r.canPlaybackAudio ?? false);
            try { console.debug('[AV][debug] audioPlaybackStatusChanged', { canPlaybackAudio: can }); } catch {}
            if (can) { try { this.removeAudioUnlockHandlers?.(); } catch {}; this.removeAudioUnlockHandlers = null; }
          };
          const onActiveSpeakers = () => {
            try {
              const list: any[] = (r as any).activeSpeakers || [];
              this.activeSpeakerIds = list.map((p: any) => String(p.identity || '')).filter(Boolean);
              try { console.debug('[AV][debug] activeSpeakers', { ids: this.activeSpeakerIds }); } catch {}
              this.applyDesiredSubscriptions();
            } catch {}
          };
          r.on?.('reconnected', onReconnected);
          r.on?.('disconnected', onDisconnected);
          r.on?.('trackPublished', onTrackPublished);
          r.on?.('trackSubscribed', onTrackSubscribed);
          try { r.on?.('trackUnsubscribed', (_t: any, _p: any, _pp: any) => { try { this.ensureSubscribeAllAudio(64); this.applyDesiredSubscriptions(); } catch {} }); } catch {}
          try { r.on?.('trackUnpublished', (_p: any, _pp: any) => { try { this.ensureSubscribeAllAudio(64); this.applyDesiredSubscriptions(); } catch {} }); } catch {}
          try { r.on?.('trackMuted', (_p: any, _pp: any) => { try { this.ensureSubscribeAllAudio(64); this.applyDesiredSubscriptions(); } catch {} }); } catch {}
          try { r.on?.('trackUnmuted', (_p: any, _pp: any) => { try { this.ensureSubscribeAllAudio(64); this.applyDesiredSubscriptions(); } catch {} }); } catch {}
          r.on?.('connectionQualityChanged', onConnQuality);
          r.on?.('participantConnected', onParticipantConnected);
          r.on?.('participantDisconnected', onParticipantDisconnected);
          r.on?.('audioPlaybackStatusChanged', onAudioPlayback);
          r.on?.('activeSpeakersChanged', onActiveSpeakers);
          this.roomHandlersCleanup = () => {
            try { r.off?.('reconnected', onReconnected); } catch {}
            try { r.off?.('disconnected', onDisconnected); } catch {}
            try { r.off?.('trackPublished', onTrackPublished); } catch {}
            try { r.off?.('trackSubscribed', onTrackSubscribed); } catch {}
            try { r.off?.('connectionQualityChanged', onConnQuality); } catch {}
            try { r.off?.('participantConnected', onParticipantConnected); } catch {}
            try { r.off?.('participantDisconnected', onParticipantDisconnected); } catch {}
            try { r.off?.('audioPlaybackStatusChanged', onAudioPlayback); } catch {}
            try { r.off?.('activeSpeakersChanged', onActiveSpeakers); } catch {}
          };
        }
      } catch {
        // Fallback: wenn Event-Konstanten fehlen, zumindest einmal versuchen
        this.scheduleReconnect();
      }
    })();

    // Proximity-basierte Subscriptions: nur in Bubble (ids)
    try { this.unsubscribeBus?.(); } catch {}
    this.unsubscribeBus = onBubbleMembersUpdate((ids: string[]) => {
      this.lastProximityAt = Date.now();
      this.handleDesiredIdsUpdate(ids);
      // Bubble-Dämpfung anwenden
      this.applyBubbleAttenuation(ids);
    });

    // Fallback: Wenn keine Proximity-Events eintreffen, abonniere bis zu N Audio-Tracks
    try { if (this.fallbackSubTimer) clearInterval(this.fallbackSubTimer); } catch {}
    const MAX_AUDIO = Math.max(1, Number((import.meta as any).env?.VITE_AV_MAX_AUDIO_SUBS || 6));
    this.fallbackSubTimer = setInterval(() => {
      const room: any = this.current as any;
      if (!room) return;
      if (this.dnd) return;
      // Nur arbeiten, wenn verbunden
      const st = room.connectionState || room.state;
      if (!(st === 'connected' || st === 2) || !this.isSignalOpen()) return;
      const since = Date.now() - this.lastProximityAt;
      if (since < 3000) return; // Proximity aktiv → kein Fallback nötig
      try {
        const parts: any[] = Array.from((room.remoteParticipants?.values?.() || []) as any);
        const chosen = parts.slice(0, MAX_AUDIO);
        const key = JSON.stringify(chosen.map((p: any) => String(p.identity || '')).sort());
        if (key === this.lastFallbackChosenKey) return;
        this.lastFallbackChosenKey = key;
        for (const p of parts) {
          const should = chosen.includes(p);
          const identity = String(p.identity || '');
          const pubs: any[] = Array.from((p.trackPublications?.values?.() || []) as any);
          for (const pub of pubs) {
            const kind = (pub as any).kind ?? (pub.track as any)?.kind;
            if (kind === 'audio') this.setDesired(pub, identity, 'audio', !!should);
          }
        }
      } catch {}
    }, 4000);
  }

  private unwireRoomEvents() {
    try { this.roomHandlersCleanup?.(); } catch {}
    this.roomHandlersCleanup = null;
  }

  private handleDesiredIdsUpdate(ids: string[]): void {
    try {
      const normalized = Array.from(new Set(ids.map(id => String(id || '')))).sort();
      const a = JSON.stringify(normalized);
      const b = JSON.stringify(Array.from(new Set(this.desiredIds)).sort());
      if (a === b) return;
      this.desiredIds = normalized;
      try { if (this.bubbleDebounceTimer) clearTimeout(this.bubbleDebounceTimer); } catch {}
      this.bubbleDebounceTimer = setTimeout(() => {
        this.bubbleDebounceTimer = null;
        this.applyDesiredSubscriptions();
      }, 200);
    } catch {}
  }

  private applyDesiredSubscriptions(): void {
    const room: any = this.current as any;
    try {
      const nParts = Array.from((room?.remoteParticipants?.values?.() || []) as any).length;
      console.debug('[AV][debug] applyDesiredSubscriptions', { desiredIds: this.desiredIds, activeSpeakerIds: this.activeSpeakerIds, nParts });
    } catch {}
    applySubscriptionsCtl({
      room,
      isSignalOpen: () => this.isSignalOpen(),
      dnd: this.dnd,
      desiredIds: this.desiredIds,
      activeSpeakerIds: this.activeSpeakerIds,
      maxVideoSubs: this.maxVideoSubs,
      setDesired: (pub, identity, kind, should) => this.setDesired(pub, identity, kind, should),
      lastDesiredIdsKeyRef: this.lastDesiredIdsKeyRef,
    });
    try { avLog('debug', 'av.subscriptions.applied', { nDesired: this.desiredIds.length }, { identity: this.identity, roomName: this.currentName || undefined as any }); } catch {}
    try { console.debug('[AV][debug] subscriptions.applied', { nDesired: this.desiredIds.length, key: this.lastDesiredIdsKeyRef.current }); } catch {}
  }

  private ensureSubscribeAllAudio(maxCount: number = 32): void {
    const room: any = this.current as any;
    if (this.dnd) return;
    ensureSubscribeAllAudioCtl(room, () => this.isSignalOpen(), (pub, identity, kind, should) => this.setDesired(pub, identity, kind, should), maxCount);
    try {
      const parts: any[] = Array.from((room?.remoteParticipants?.values?.() || []) as any);
      let nAudio = 0; let nSub = 0;
      for (const p of parts) {
        const pubs: any[] = Array.from((p?.trackPublications?.values?.() || []) as any);
        for (const pub of pubs) {
          const kind = (pub as any).kind ?? (pub as any)?.track?.kind;
          if (kind === 'audio') {
            nAudio++;
            if (this.getSubscribed(pub)) nSub++;
          }
        }
      }
      console.debug('[AV][debug] ensureSubscribeAllAudio.result', { nParticipants: parts.length, nAudioPubs: nAudio, nAudioSubscribed: nSub, maxCount });
    } catch {}
  }

  private applyBubbleAttenuation(bubbleIds: string[]): void {
    const room = this.current as any;
    if (!room) return;
    try {
      const bubble = new Set((bubbleIds || []).map(id => String(id)));
      const participants: any[] = Array.from((room.remoteParticipants?.values?.() || []) as any);
      for (const p of participants) {
        const id = String(p.identity || '');
        const inBubble = bubble.has(id);
        const pubs: any[] = Array.from((p.trackPublications?.values?.() || []) as any);
        for (const pub of pubs) {
          const kind = (pub as any).kind ?? (pub as any)?.track?.kind;
          if (kind !== 'audio') continue;
          const track: any = (pub as any).track;
          if (!track) continue;
          // Einfaches Model: Bubble-Mitglieder werden für Außenstehende leiser und umgekehrt
          try {
            const vol = inBubble ? this.bubbleAttenuation : 1;
            if (typeof track.setVolume === 'function') {
              track.setVolume(vol);
            }
          } catch {}
        }
      }
    } catch {}
  }

  private setDesired(pub: any, identity: string, kind: 'audio'|'video', should: boolean): void {
    try {
      const key = `${identity}:${kind}`;
      const prev = this.lastDesiredSubs.get(key);
      if (prev === should) return;
      // Video-Hysterese: Verhindere schnelles Flapping beim Abschalten
      if (kind === 'video') {
        if (should) {
          this.lastVideoOnAt.set(identity, Date.now());
        } else {
          const lastOn = this.lastVideoOnAt.get(identity) || 0;
          if (Date.now() - lastOn < this.videoRetentionMs) {
            return; // innerhalb Retention: nicht deaktivieren
          }
        }
      }
      this.lastDesiredSubs.set(key, should);
      try {
        const src = (pub as any).source ?? (pub as any)?.track?.source;
        const isSubBefore = this.getSubscribed(pub);
        console.debug('[AV][debug] ensureSubscribed.call', { identity, kind, src, should, isSubBefore });
      } catch {}
      this.ensureSubscribed(pub, should);
      try {
        const isSubAfter = this.getSubscribed(pub);
        console.debug('[AV][debug] ensureSubscribed.done', { identity, kind, should, isSubAfter });
      } catch {}
    } catch {}
  }

  private startStatsLoop() { startStatsLoopImpl(this as any); }

  private onConnectionQualityChanged(participant: any, quality: any) { return onConnectionQualityChangedImpl(this as any, participant, quality); }

  private async restoreDesiredTracks(): Promise<void> {
    try {
      if (!this.current) return;
      // Warte kurz, bis connection vollständig stabil ist
      await this.waitForConnected(this.current as any).catch(() => {});
      if (this.lastMicDesired) { try { await this.setMicrophoneEnabled(true); } catch {} }
      if (this.lastCamDesired) { try { await this.setCameraEnabled(true); } catch {} }
    } catch {}
  }

  private async applyDefaultRemoteQuality(): Promise<void> { return applyDefaultRemoteQualityImpl(this as any); }

  private attachAudioUnlockHandlers() {
    if (this.audioUnlockHandlersAttached) return;
    this.audioUnlockHandlersAttached = true;
    const handler = async () => {
      try {
        const anyRoom: any = this.current as any;
        const before = !!(anyRoom?.canPlaybackAudio ?? false);
        const r = await (anyRoom?.startAudio?.());
        const after = !!(anyRoom?.canPlaybackAudio ?? false);
        console.debug('[AV][debug] startAudio on unlock', { before, result: r, after });
      } catch (e) { try { console.warn('[AV][debug] startAudio unlock error', e); } catch {} }
      // Nach Audio-Unlock: sichere Subscriptions/Publishes sofort anwenden
      try { this.ensureSubscribeAllAudio(64); } catch {}
      try { this.applyDesiredSubscriptions(); } catch {}
      try { void this.restoreDesiredTracks(); } catch {}
      const anyRoom: any = this.current as any;
      const can = !!(anyRoom?.canPlaybackAudio ?? false);
      if (can) cleanup();
    };
    const opts: AddEventListenerOptions | boolean = true;
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'click', 'keydown', 'touchstart'];
    events.forEach(ev => window.addEventListener(ev, handler as any, opts));
    const cleanup = () => {
      events.forEach(ev => window.removeEventListener(ev, handler as any, true));
      this.audioUnlockHandlersAttached = false;
      // audio unlocked
    };
    this.removeAudioUnlockHandlers = cleanup;
  }

  // ensureAudioPlaybackUnlocked removed (not used)

  private async waitForConnected(room: Room, timeoutMs: number = 5000): Promise<void> {
    const anyRoom: any = room as any;
    const isConnectedNow = () => {
      const state = anyRoom.connectionState || anyRoom.state;
      return state === 'connected' || state === 2; // enum fallback
    };
    if (isConnectedNow()) return;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; try { clearTimeout(timer); } catch {}; resolve(); } };
      let off: any = null;
      (async () => {
        try {
          const mod = await import('livekit-client');
          const RoomEvent = (mod as any).RoomEvent;
          const handler = () => { if (isConnectedNow()) { try { anyRoom.off?.(RoomEvent?.ConnectionStateChanged || 'connectionStateChanged', handler); } catch {}; finish(); } };
          anyRoom.on?.(RoomEvent?.ConnectionStateChanged || 'connectionStateChanged', handler);
          off = () => anyRoom.off?.(RoomEvent?.ConnectionStateChanged || 'connectionStateChanged', handler);
        } catch {
          finish();
        }
      })();
      const timer = setTimeout(() => { try { off?.(); } catch {}; finish(); }, timeoutMs);
    });
  }

  async startScreenshare(): Promise<boolean> {
    if (!this.current) return false;
    if (this.sharePending) return false;
    // If already sharing, do nothing
    if (this.isScreensharing()) return true;
    try {
      this.sharePending = true;
      try { console.debug('[AV][debug] screenshare.start'); } catch {}
      // WICHTIG: getDisplayMedia muss direkt aus der User-Geste aufgerufen werden.
      // Daher zuerst Tracks holen (öffnet den Picker), dann erst auf Verbindung warten/publizieren.
      const tracks = await createLocalScreenTracks({
        video: { frameRate: 30, resolution: { width: 1920, height: 1080 } } as any,
        audio: true,
      } as any);
      try {
        // Nach der Auswahl Verbindung sicherstellen
        await this.waitForConnected(this.current).catch(()=>{});
      } catch {}
      // Kamera standardmäßig nicht mehr deaktivieren. Optional via Flag.
      const disableCamOnShare = ((import.meta as any).env?.VITE_AV_DISABLE_CAMERA_ON_SHARE === 'true');
      if (disableCamOnShare) {
        try { await this.setCameraEnabled(false); } catch {}
      }
      for (const t of tracks) {
        await this.current.localParticipant.publishTrack(t);
        try {
          const mst: any = (t as any)?.mediaStreamTrack;
          if (mst && 'contentHint' in mst) {
            try { mst.contentHint = 'detail'; } catch {}
          }
          (t as any)?.setContentHint?.('detail');
          try {
            const src: any = (t as any)?.source;
            const info = { id: mst?.id, kind: mst?.kind, readyState: mst?.readyState, hint: (mst as any)?.contentHint, src };
            console.debug('[AV][debug] screenshare.published.track', info);
          } catch {}
          // Auto-stop wenn User die Freigabe im System beendet
          if (mst && typeof mst.addEventListener === 'function') {
            const onEnded = () => { try { this.stopScreenshare().catch(()=>{}); } catch {} };
            try { mst.addEventListener('ended', onEnded, { once: true } as any); } catch {}
          }
        } catch {}
      }
      // Nach Publish: bevorzugte Layer/Bitrate setzen (falls unterstützt)
      try {
        const pubs = Array.from(this.current.localParticipant.trackPublications.values());
        for (const pub of pubs) {
          const src = (pub as any).source || (pub.track as any)?.source;
          if (src === 'screen_share' && (pub as any).setVideoLayers) {
            try { (pub as any).setVideoLayers?.([{ width: 1920, height: 1080, bitrate: 2500_000 }]); } catch {}
          }
        }
      } catch {}
      try { console.debug('[AV][debug] screenshare.start.done'); } catch {}
      this.sharePending = false;
      return true;
    } catch (e: any) {
      // Bei Abbruch/Verweigerung keinen Fehler werfen, sondern false zurück
      this.sharePending = false;
      return false;
    }
  }

  async stopScreenshare() {
    if (!this.current) return;
    try {
      const room = this.current;
      if (!room) return;
      const pubs = Array.from(room.localParticipant.trackPublications.values());
      for (const pub of pubs) {
        const src = (pub as any).source || (pub.track as any)?.source;
        if (src && (src === 'screen_share' || src === 'screen_share_audio')) {
        try { await room.localParticipant.unpublishTrack(pub.track!); } catch {}
          try { (pub.track as any)?.stop?.(); } catch {}
        }
      }
    } catch (e) {
      // Stop screenshare failed silently
    }
  }

  private isScreensharing(): boolean {
    const room = this.current;
    if (!room) return false;
    try {
      const pubs = Array.from(room.localParticipant.trackPublications.values());
      return pubs.some((pub: any) => {
        const src = (pub as any).source || (pub.track as any)?.source;
        return src === 'screen_share' || src === 'screen_share_audio';
      });
    } catch {
      return false;
    }
  }

  async setDoNotDisturb(enabled: boolean): Promise<void> {
    this.dnd = !!enabled;
    try { avLog('info', 'av.dnd.toggle', { enabled: this.dnd }, { identity: this.identity, roomName: this.currentName || undefined as any }); } catch {}
    const room: any = this.current as any;
    if (!room) return;
    if (this.dnd) {
      // Lokale Publishes stoppen
      try { await this.setMicrophoneEnabled(false); } catch {}
      try { await this.setCameraEnabled(false); } catch {}
      try { await this.stopScreenshare(); } catch {}
      // Sofort: alle Remote-Audio stumm schalten (unabhängig von Subscribe-State)
      try {
        const parts: any[] = Array.from((room.remoteParticipants?.values?.() || []) as any);
        for (const p of parts) {
          const pubs: any[] = Array.from((p.trackPublications?.values?.() || []) as any);
          for (const pub of pubs) {
            const kind = (pub as any).kind ?? (pub.track as any)?.kind;
            if (kind === 'audio') {
              try { (pub as any)?.track?.setVolume?.(0); } catch {}
            }
          }
        }
      } catch {}
      // Remote-Abos deaktivieren
      try {
        const parts: any[] = Array.from((room.remoteParticipants?.values?.() || []) as any);
        for (const p of parts) {
          const identity = String(p.identity || '');
          const pubs: any[] = Array.from((p.trackPublications?.values?.() || []) as any);
          for (const pub of pubs) {
            const kind = (pub as any).kind ?? (pub.track as any)?.kind;
            if (kind === 'audio') this.setDesired(pub, identity, 'audio', false);
            if (kind === 'video') this.setDesired(pub, identity, 'video', false);
          }
        }
      } catch {}
    } else {
      // Wiederherstellen
      try { await this.restoreDesiredTracks(); } catch {}
      try { this.applyDesiredSubscriptions(); } catch {}
      // Sofort: Remote-Audio auf 1 setzen (Bubble/Attenuation greift danach wieder)
      try {
        const parts: any[] = Array.from((room.remoteParticipants?.values?.() || []) as any);
        for (const p of parts) {
          const pubs: any[] = Array.from((p.trackPublications?.values?.() || []) as any);
          for (const pub of pubs) {
            const kind = (pub as any).kind ?? (pub.track as any)?.kind;
            if (kind === 'audio') {
              try { (pub as any)?.track?.setVolume?.(1); } catch {}
            }
          }
        }
      } catch {}
    }
  }

  async ensurePermissions(audio: boolean, video: boolean): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video });
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch {}
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    this.lastMicDesired = !!enabled;
    // Wenn kein Room oder nicht verbunden → als pending setzen und Berechtigungen anfragen
    const notConnected = !this.current || !this.isConnected;
    if (notConnected) {
      this.pendingMic = enabled;
      if (enabled) await this.ensurePermissions(true, false);
      return;
    }
    this.pendingMic = false; // Clear pending flag when we have a room
    try {
      const room = this.current;
      if (!room) return;
      const pubs = Array.from(room.localParticipant.trackPublications.values());
      const micPubs = (pubs as any[]).filter((pub: any) => {
        const src = (pub as any).source ?? (pub as any)?.track?.source;
        const kind = (pub as any).kind ?? (pub as any)?.track?.kind;
        return src === 'microphone' || src === 0 || src === 2 || kind === 'audio';
      });
      // Prüfe, ob vorhandene Mic-Tracks wirklich "live" sind. Browser können
      // lange inaktive Tracks automatisch beenden. In diesem Fall müssen wir
      // vor dem (Re-)Aktivieren alte Publishes entfernen.
      const hasLiveMic = micPubs.some((p: any) => {
        const t: any = (p as any)?.track;
        const mst: any = t?.mediaStreamTrack || t;
        const ready: string | undefined = mst?.readyState;
        const enabled: boolean | undefined = (t?.isEnabled ?? t?.enabled ?? mst?.enabled);
        return !!t && (ready === undefined || ready === 'live') && enabled !== false;
      });
      const hasAnyMicTrack = micPubs.some((p: any) => !!((p as any)?.track));
      if (enabled) {
        // Stelle sicher, dass Audio-Wiedergabe freigeschaltet ist (User-Geste erforderlich)
        try {
          const anyRoom: any = this.current as any;
          const before = !!(anyRoom?.canPlaybackAudio ?? false);
          const r = await (anyRoom?.startAudio?.());
          const after = !!(anyRoom?.canPlaybackAudio ?? false);
          console.debug('[AV][debug] startAudio on mic enable', { before, result: r, after });
        } catch (e) { try { console.warn('[AV][debug] startAudio mic error', e); } catch {} }
        // Wenn ein Track existiert, der aber nicht mehr live ist, zuerst sauber entfernen
        if (hasAnyMicTrack && !hasLiveMic) {
          for (const pub of micPubs) {
            const track: any = (pub as any)?.track;
            if (!track) continue;
            try { await room.localParticipant.unpublishTrack(track); } catch {}
            try { (track as any)?.stop?.(); } catch {}
          }
        }
        if (hasLiveMic) return; // bereits aktiv
        const settings = useAvSettingsStore.getState().settings;
        const localAudioTrack: any = await buildAudioPipeline({ ...(this.preferredMic ? { deviceId: this.preferredMic } : {}), settings } as any);
        try {
          const mst: any = (localAudioTrack as any)?.mediaStreamTrack || localAudioTrack;
          if (mst && 'contentHint' in mst) { try { mst.contentHint = 'speech'; } catch {} }
          (localAudioTrack as any)?.setContentHint?.('speech');
        } catch {}
        await room.localParticipant.publishTrack(localAudioTrack, { source: 'microphone' } as any);
        try {
          const mst: any = (localAudioTrack as any)?.mediaStreamTrack || localAudioTrack;
          const info = mst ? { id: mst.id, kind: mst.kind, label: mst.label, enabled: mst.enabled, readyState: mst.readyState, hint: (mst as any).contentHint } : {};
          avLog('info', 'av.mic.published', info as any, { identity: this.identity, roomName: this.currentName || undefined as any });
          console.debug('[AV][debug] mic published', info);
          try {
            mst?.addEventListener?.('ended', () => {
              try { console.warn('[AV][debug] mic track ended'); } catch {}
              // Auto-Republish, falls weiterhin gewünscht
              try {
                if (this.lastMicDesired) {
                  setTimeout(() => { void this.setMicrophoneEnabled(true).catch(()=>{}); }, 150);
                }
              } catch {}
            }, { once: true } as any);
          } catch {}
          // Watchdog: Falls der lokale Mic-Status nach kurzer Zeit nicht wirklich aktiv ist, erzwinge ein schnelles Re-Publish über einen simpleren Pfad
          try {
            const recheck = async () => {
              try {
                const mod: any = await import('./core/localState');
                const ok = mod.isLocalMicOn(room as any);
                if (!ok && this.lastMicDesired) {
                  // Hartes Cleanup evtl. toter Publishes
                  try {
                    const pubs2 = Array.from(room.localParticipant.trackPublications.values());
                    for (const pub of pubs2) {
                      const src2 = (pub as any).source ?? (pub as any)?.track?.source;
                      const kind2 = (pub as any).kind ?? (pub as any)?.track?.kind;
                      const isMic2 = src2 === 'microphone' || src2 === 0 || kind2 === 'audio';
                      if (isMic2 && (pub as any)?.track) {
                        try { await room.localParticipant.unpublishTrack((pub as any).track); } catch {}
                        try { ((pub as any).track as any)?.stop?.(); } catch {}
                      }
                    }
                  } catch {}
                  try {
                    const lkc: any = await import('livekit-client');
                    const simple: any = await (lkc as any).createLocalAudioTrack({
                      ...(this.preferredMic ? { deviceId: this.preferredMic } : {}),
                      echoCancellation: true,
                      noiseSuppression: true,
                      autoGainControl: true,
                    } as any);
                    await room.localParticipant.publishTrack(simple, { source: 'microphone' } as any);
                    try { console.debug('[AV][debug] mic republish (watchdog) done'); } catch {}
                  } catch (e) { try { console.warn('[AV][debug] mic watchdog republish failed', e); } catch {} }
                }
              } catch {}
            };
            setTimeout(recheck, 1200);
            setTimeout(recheck, 5000);
          } catch {}
        } catch {}
      } else {
        for (const pub of micPubs) {
          try {
            const t: any = (pub as any)?.track;
            const mst: any = t?.mediaStreamTrack || t;
            // Sofortige lokale Stummschaltung für snappiges UI
            if (typeof t?.setEnabled === 'function') {
              try { t.setEnabled(false); } catch {}
            } else if (mst && typeof mst.enabled === 'boolean') {
              try { mst.enabled = false; } catch {}
            }
            // Unpublish im Hintergrund, um Signaling-Latenz nicht zu blockieren
            try { void room.localParticipant.unpublishTrack(t); } catch {}
          } catch {}
        }
      }
    } catch (e: any) {
      // Versuche breiteres Recovery: Permissions anfragen und einmalig retry
      const name = e?.name || '';
      const recoverable = ['NotAllowedError','NotFoundError','AbortError','NotReadableError','SecurityError','OverconstrainedError'].includes(name);
      if (enabled) {
        try {
          const ok = recoverable ? await this.ensurePermissions(true, false) : false;
          if (ok) return this.setMicrophoneEnabled(true);
        } catch {}
        console.error('Failed to enable microphone:', e);
        throw e;
      }
    }
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    this.lastCamDesired = !!enabled;
    const notConnected = !this.current || !this.isConnected;
    if (notConnected) {
      this.pendingCam = enabled;
      if (enabled) await this.ensurePermissions(false, true);
      return;
    }
    this.pendingCam = false; // Clear pending flag when we have a room
    try {
      const room = this.current;
      if (!room) return;
      const pubs = Array.from(room.localParticipant.trackPublications.values());
      const camPubs = (pubs as any[]).filter((pub: any) => {
        const src = (pub as any).source ?? (pub as any)?.track?.source;
        const kind = (pub as any).kind ?? (pub as any)?.track?.kind;
        return src === 'camera' || src === 1 || (kind === 'video' && src !== 'screen_share');
      });
      const hasLiveCam = camPubs.some((p: any) => {
        const t: any = (p as any)?.track;
        const mst: any = t?.mediaStreamTrack || t;
        const ready: string | undefined = mst?.readyState;
        const enabled: boolean | undefined = (t?.isEnabled ?? t?.enabled ?? mst?.enabled);
        return !!t && (ready === undefined || ready === 'live') && enabled !== false;
      });
      const hasAnyCamTrack = camPubs.some((p: any) => !!((p as any)?.track));
      if (enabled) {
        // Entferne alte, beendete/disabled Tracks vor Republish
        if (hasAnyCamTrack && !hasLiveCam) {
          for (const pub of camPubs) {
            const track: any = (pub as any)?.track;
            if (!track) continue;
            try { await room.localParticipant.unpublishTrack(track); } catch {}
            try { (track as any)?.stop?.(); } catch {}
          }
        }
        if (hasLiveCam) return; // bereits aktiv
        const { createLocalTracks } = await import('livekit-client');
        const tracks = await createLocalTracks({ video: this.preferredCam ? { deviceId: this.preferredCam, facingMode: 'user' } : { facingMode: 'user' } });
        for (const t of tracks) {
          if ((t as any).kind === 'video') {
            try {
              await room.localParticipant.publishTrack(t);
            } catch (e) {
              throw e; // Re-throw to handle in UI
            }
            try {
              const mst: any = (t as any)?.mediaStreamTrack || t;
              mst?.addEventListener?.('ended', () => {
                try { console.warn('[AV][debug] camera track ended'); } catch {}
                try {
                  if (this.lastCamDesired) {
                    setTimeout(() => { void this.setCameraEnabled(true).catch(()=>{}); }, 150);
                  }
                } catch {}
              }, { once: true } as any);
            } catch {}
          }
        }
      } else {
        for (const pub of camPubs) {
          try {
            const t: any = (pub as any)?.track;
            const mst: any = t?.mediaStreamTrack || t;
            // Sofortige lokale Deaktivierung für snappiges UI
            if (typeof t?.setEnabled === 'function') {
              try { t.setEnabled(false); } catch {}
            } else if (mst && typeof mst.enabled === 'boolean') {
              try { mst.enabled = false; } catch {}
            }
            // Unpublish asynchron, um UI nicht zu blockieren
            try { void room.localParticipant.unpublishTrack(t); } catch {}
          } catch {}
        }
      }
    } catch (e: any) {
      // Breiteres Recovery für Kamera
      const name = e?.name || '';
      const recoverable = ['NotAllowedError','NotFoundError','AbortError','NotReadableError','SecurityError','OverconstrainedError'].includes(name);
      if (enabled) {
        try {
          const ok = recoverable ? await this.ensurePermissions(false, true) : false;
          if (ok) return this.setCameraEnabled(true);
        } catch {}
      }
      // ansonsten still
    }
  }

  async useMicrophoneDevice(deviceId: string) {
    this.preferredMic = deviceId;
    if (!this.current) return;
    // Nur wechseln, wenn Mic aktuell aktiv ist; sonst nur merken
    const pubs = Array.from(this.current.localParticipant.trackPublications.values());
    const micPubs = pubs.filter(pub => {
      const src = (pub as any).source || (pub.track as any)?.source;
      return src === 'microphone';
    });
    if (micPubs.length === 0) return; // Mic ist derzeit aus – nur Präferenz setzen
    await this.setMicrophoneEnabled(false);
    await this.setMicrophoneEnabled(true);
  }

  async useCameraDevice(deviceId: string) {
    this.preferredCam = deviceId;
    if (!this.current) return;
    // Nur wechseln, wenn Kamera aktuell aktiv ist; sonst nur Präferenz setzen
    const pubs = Array.from(this.current.localParticipant.trackPublications.values());
    const camPubs = pubs.filter(pub => {
      const src = (pub as any).source || (pub.track as any)?.source;
      return src === 'camera';
    });
    if (camPubs.length === 0) return; // Kamera ist derzeit aus – nur Präferenz setzen
    await this.setCameraEnabled(false);
    await this.setCameraEnabled(true);
  }

  async listDevices(): Promise<AVDevices> {
    const safeEnumerate = async (): Promise<MediaDeviceInfo[]> => {
      try { return await navigator.mediaDevices.enumerateDevices(); } catch { return []; }
    };
    let devices = await safeEnumerate();
    let microphones = devices
      .filter(d => d.kind === 'audioinput')
      .map(d => ({ deviceId: d.deviceId, label: d.label }));
    let cameras = devices
      .filter(d => d.kind === 'videoinput')
      .map(d => ({ deviceId: d.deviceId, label: d.label }));

    // Manche Browser (Safari/Firefox) liefern erst nach getUserMedia-Geräte mit Labels
    const missingAnyDevices = (microphones.length === 0 && cameras.length === 0);
    const labelsMissing = devices.length > 0 && devices.every(d => !d.label);
    if (missingAnyDevices || labelsMissing) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        try { for (const t of stream.getTracks()) { try { t.stop(); } catch {} } } catch {}
      } catch {
        // Wenn Benutzer verweigert, geben wir die (evtl. leere) Liste zurück
      }
      devices = await safeEnumerate();
      microphones = devices
        .filter(d => d.kind === 'audioinput')
        .map(d => ({ deviceId: d.deviceId, label: d.label }));
      cameras = devices
        .filter(d => d.kind === 'videoinput')
        .map(d => ({ deviceId: d.deviceId, label: d.label }));
    }

    // Duplikate (z.B. 'default') entfernen
    const uniqueById = <T extends { deviceId: string }>(arr: T[]): T[] => {
      const seen = new Set<string>();
      const result: T[] = [];
      for (const item of arr) {
        if (seen.has(item.deviceId)) continue;
        seen.add(item.deviceId);
        result.push(item);
      }
      return result;
    };
    microphones = uniqueById(microphones).map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    cameras = uniqueById(cameras).map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
    return { microphones, cameras };
  }
}
