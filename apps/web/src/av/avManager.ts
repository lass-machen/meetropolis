const SIMPLE = (import.meta as any).env?.VITE_AV_SIMPLE === 'true';
const ALLOW_RECONNECT = (import.meta as any).env?.VITE_AV_RECONNECT !== 'false';
import { Room, createLocalScreenTracks } from 'livekit-client';
import { joinLivekitRoom } from '../lib/livekit';
import { onBubbleMembersUpdate } from '../lib/avEvents';

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
  private isConnecting = false;
  private connectSeq = 0;
  private isDisconnecting = false;
  private preferredMic?: string;
  private preferredCam?: string;
  private pendingMic = false;
  private pendingCam = false;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private unsubscribeBus: (() => void) | null = null;
  private lastProximityAt = 0;
  private fallbackSubTimer: any = null;
  // Audio-Unlock State
  private audioUnlocked = false;
  private audioUnlockHandlersAttached = false;
  private removeAudioUnlockHandlers: (() => void) | null = null;
  // Local camera quality adaptation
  private camQuality: 'low' | 'med' | 'high' = 'high';
  private qualityCooldownUntil = 0;

  constructor(opts: { baseUrl: string; identity: string; displayName?: string; useVideo: boolean }) {
    this.baseUrl = opts.baseUrl;
    this.identity = opts.identity;
    this.displayName = opts.displayName || opts.identity;
    this.useVideo = opts.useVideo;
  }

  get isConnected(): boolean {
    return !!this.current;
  }

  async switchTo(roomName: string) {
    if (this.currentName === roomName) return;
    const name = roomName || 'world';
    const seq = ++this.connectSeq;
    if (!SIMPLE && this.isConnecting) return; // Debounce parallele Verbindungsversuche
    this.isConnecting = true;
    try {
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
      this.currentName = name;
      this.reconnectAttempts = 0;
      this.wireRoomEvents();
      // Audio-Wiedergabe erst per Nutzerinteraktion freischalten
      this.attachAudioUnlockHandlers();
      if (!SIMPLE) {
        await this.waitForConnected(room).catch(()=>{});
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
      }, 250);
    }
  }

  async leave() {
    if (this.current) {
      this.isDisconnecting = true;
      try { await this.current.disconnect(); } catch {}
    }
    try { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); } catch {}
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    try { this.unsubscribeBus?.(); } catch {}
    this.unsubscribeBus = null;
    try { if (this.fallbackSubTimer) clearInterval(this.fallbackSubTimer); } catch {}
    this.fallbackSubTimer = null;
    this.current = undefined;
    this.currentName = null;
    setTimeout(() => { this.isDisconnecting = false; }, 50);
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
      const participants = Array.from((room as any).remoteParticipants?.values() || []);
      const p = participants.find((participant: any) => participant.identity === identity);
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
    (async () => {
      try {
        const mod = await import('livekit-client');
        const RoomEvent = (mod as any).RoomEvent;
        // const ParticipantEvent = (mod as any).ParticipantEvent;
        if (RoomEvent) {
          room.off?.(RoomEvent.Reconnected, () => {});
          room.off?.(RoomEvent.Disconnected, () => {});
          room.on?.(RoomEvent.Reconnected, () => { this.reconnectAttempts = 0; });
          room.on?.(RoomEvent.Disconnected, () => { if (ALLOW_RECONNECT && !this.isDisconnecting) this.scheduleReconnect(); });
          // Auf neue/aktualisierte Tracks reagieren (Remote-Video-Qualität standardmäßig drosseln)
          try {
            room.off?.(RoomEvent.TrackPublished, (() => {}) as any);
            room.off?.(RoomEvent.TrackSubscribed, (() => {}) as any);
            room.on?.(RoomEvent.TrackPublished, () => { try { this.applyDefaultRemoteQuality(); } catch {} });
            room.on?.(RoomEvent.TrackSubscribed, () => { try { this.applyDefaultRemoteQuality(); } catch {} });
          } catch {}
          // Verbindungsgüte beobachten → Kameraqualität dynamisch anpassen
          try {
            room.off?.(RoomEvent.ConnectionQualityChanged, (() => {}) as any);
            room.on?.(RoomEvent.ConnectionQualityChanged, (participant: any, quality: any) => {
              try { this.onConnectionQualityChanged(participant, quality); } catch {}
            });
          } catch {}
          // Audio-Playback-Status beobachten (falls von SDK unterstützt)
          try {
            room.off?.(RoomEvent.AudioPlaybackStatusChanged, (() => {}) as any);
            room.on?.(RoomEvent.AudioPlaybackStatusChanged, () => {
              const anyRoom: any = room as any;
              const can = !!(anyRoom.canPlaybackAudio ?? false);
              if (can) {
                this.audioUnlocked = true;
                try { this.removeAudioUnlockHandlers?.(); } catch {}
                this.removeAudioUnlockHandlers = null;
              }
            });
          } catch {}
        } else {
          const r: any = room as any;
          r.off?.('reconnected', () => {});
          r.off?.('disconnected', () => {});
          r.on?.('reconnected', () => { this.reconnectAttempts = 0; });
          r.on?.('disconnected', () => { if (ALLOW_RECONNECT && !this.isDisconnecting) this.scheduleReconnect(); });
          // Fallback: Track-Events
          try {
            r.off?.('trackPublished', () => {});
            r.off?.('trackSubscribed', () => {});
            r.on?.('trackPublished', () => { try { this.applyDefaultRemoteQuality(); } catch {} });
            r.on?.('trackSubscribed', () => { try { this.applyDefaultRemoteQuality(); } catch {} });
          } catch {}
          // Fallback: Verbindungsgüte
          try {
            r.off?.('connectionQualityChanged', () => {});
            r.on?.('connectionQualityChanged', (participant: any, quality: any) => {
              try { this.onConnectionQualityChanged(participant, quality); } catch {}
            });
          } catch {}
          // Fallback-Eventnamen für ältere SDKs
          try {
            r.off?.('audioPlaybackStatusChanged', () => {});
            r.on?.('audioPlaybackStatusChanged', () => {
              const can = !!(r.canPlaybackAudio ?? false);
              if (can) {
                this.audioUnlocked = true;
                try { this.removeAudioUnlockHandlers?.(); } catch {}
                this.removeAudioUnlockHandlers = null;
              }
            });
          } catch {}
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
      const room = this.current as any;
      if (!room) return;
      try {
        const remoteParticipants: any[] = Array.from((room.remoteParticipants?.values?.() || []) as any);
        const idSet = new Set(ids);
        for (const p of remoteParticipants) {
          const shouldSub = idSet.has(String(p.identity || ''));
          const pubs: any[] = Array.from((p.trackPublications?.values?.() || []) as any);
          for (const pub of pubs) {
            const kind = (pub as any).kind ?? (pub.track as any)?.kind;
            if (kind === 'audio') {
              if (shouldSub) { try { pub.setSubscribed?.(true); } catch {} }
              else { try { pub.setSubscribed?.(false); } catch {} }
            }
            if (kind === 'video') {
              // Optional: Video nur für sehr nahe Teilnehmer
              const near = shouldSub; // später: Distanzschwelle unterscheiden
              if (near) { try { pub.setSubscribed?.(true); } catch {} }
              else { try { pub.setSubscribed?.(false); } catch {} }
            }
          }
        }
      } catch {}
    });

    // Fallback: Wenn keine Proximity-Events eintreffen, abonniere bis zu N Audio-Tracks
    try { if (this.fallbackSubTimer) clearInterval(this.fallbackSubTimer); } catch {}
    const MAX_AUDIO = Math.max(1, Number((import.meta as any).env?.VITE_AV_MAX_AUDIO_SUBS || 6));
    this.fallbackSubTimer = setInterval(() => {
      const room: any = this.current as any;
      if (!room) return;
      const since = Date.now() - this.lastProximityAt;
      if (since < 3000) return; // Proximity aktiv → kein Fallback nötig
      try {
        const parts: any[] = Array.from((room.remoteParticipants?.values?.() || []) as any);
        const chosen = parts.slice(0, MAX_AUDIO);
        for (const p of parts) {
          const should = chosen.includes(p);
          const pubs: any[] = Array.from((p.trackPublications?.values?.() || []) as any);
          for (const pub of pubs) {
            const kind = (pub as any).kind ?? (pub.track as any)?.kind;
            if (kind === 'audio') {
              if (should) { try { pub.setSubscribed?.(true); } catch {} }
              else { try { pub.setSubscribed?.(false); } catch {} }
            }
          }
        }
      } catch {}
    }, 1000);
  }

  private onConnectionQualityChanged(participant: any, quality: any) {
    const room = this.current as any;
    if (!room) return;
    const isLocal = !!participant?.isLocal || participant?.sid === room?.localParticipant?.sid;
    if (!isLocal) return;
    const now = Date.now();
    if (now < this.qualityCooldownUntil) return;
    // Normalize quality to string
    const q = typeof quality === 'string' ? quality : (quality?.toString?.().toLowerCase?.() || String(quality));
    let desired: 'low' | 'med' | 'high' = this.camQuality;
    if (q.includes('poor') || q.includes('lost') || q.includes('bad') || q.includes('0')) desired = 'low';
    else if (q.includes('good') || q.includes('2')) desired = 'med';
    else if (q.includes('excellent') || q.includes('3')) desired = 'high';
    else desired = 'med';
    if (desired === this.camQuality) return;
    this.qualityCooldownUntil = now + 8000; // 8s Cooldown gegen Flapping
    void this.republishCameraProfile(desired).catch(() => {});
  }

  private async republishCameraProfile(profile: 'low' | 'med' | 'high'): Promise<void> {
    const room = this.current;
    if (!room) return;
    try {
      const pubs = Array.from(room.localParticipant.trackPublications.values());
      const camPubs = pubs.filter(pub => {
        const src = (pub as any).source ?? (pub.track as any)?.source;
        const kind = (pub as any).kind ?? (pub.track as any)?.kind;
        return src === 'camera' || src === 1 || (kind === 'video' && src !== 'screen_share');
      });
      // Kamera derzeit nicht aktiv → nichts zu tun
      if (!camPubs.some(p => !!(p as any).track)) { this.camQuality = profile; return; }
      // Unpublish aktuelle Kamera
      for (const pub of camPubs) {
        try { await room.localParticipant.unpublishTrack(pub.track!); } catch {}
      }
      // Neue Kamera-Constraints je Profil
      const presets: Record<'low'|'med'|'high', { width: number; height: number; frameRate: number; bitrate: number }>
        = {
          low: { width: 320, height: 180, frameRate: 15, bitrate: 220_000 },
          med: { width: 640, height: 360, frameRate: 24, bitrate: 550_000 },
          high:{ width: 960, height: 540, frameRate: 30, bitrate: 1_200_000 }
        };
      const c = presets[profile];
      const { createLocalTracks } = await import('livekit-client');
      const videoConstraints: any = {
        facingMode: 'user',
        width: { ideal: c.width },
        height: { ideal: c.height },
        frameRate: { ideal: c.frameRate }
      };
      if (this.preferredCam) (videoConstraints as any).deviceId = this.preferredCam;
      const tracks = await createLocalTracks({ video: videoConstraints } as any);
      for (const t of tracks) {
        if ((t as any).kind === 'video') {
          try {
            try {
              const mst: any = (t as any)?.mediaStreamTrack;
              if (mst && 'contentHint' in mst) { try { mst.contentHint = 'motion'; } catch {} }
            } catch {}
            await room.localParticipant.publishTrack(t as any, {
              // @ts-ignore publish options
              videoEncoding: { maxBitrate: c.bitrate, maxFramerate: c.frameRate },
              // Behalte Simulcast; Dynacast entscheidet aktive Layer
              // @ts-ignore
              simulcast: true
            } as any);
          } catch {}
        }
      }
      this.camQuality = profile;
    } catch {
      // Ignorieren – kein harter Fehler im UI
    }
  }

  private async applyDefaultRemoteQuality(): Promise<void> {
    const room: any = this.current as any;
    if (!room) return;
    try {
      const mod = await import('livekit-client');
      const VideoQuality = (mod as any).VideoQuality || { Low: 0, Medium: 1, High: 2 };
      const participants: any[] = Array.from((room.remoteParticipants?.values?.() || []) as any);
      for (const p of participants) {
        const pubs: any[] = Array.from((p.trackPublications?.values?.() || []) as any);
        for (const pub of pubs) {
          const kind = (pub as any).kind ?? (pub.track as any)?.kind;
          const src = (pub as any).source ?? (pub.track as any)?.source;
          if (kind === 'video' && src !== 'screen_share') {
            try { (pub as any).setVideoQuality?.(VideoQuality.Medium ?? 1); } catch {}
            try { (pub as any).setPreferredVideoQuality?.(VideoQuality.Medium ?? 1); } catch {}
          }
        }
      }
    } catch {}
  }

  private attachAudioUnlockHandlers() {
    if (this.audioUnlockHandlersAttached) return;
    this.audioUnlockHandlersAttached = true;
    const handler = async () => {
      try { await (this.current as any)?.startAudio?.(); } catch {}
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
      this.audioUnlocked = true;
    };
    this.removeAudioUnlockHandlers = cleanup;
  }

  private async ensureAudioPlaybackUnlocked(): Promise<void> {
    // Kein sofortiger Startversuch mehr – nur Listener für User-Geste anhängen
    this.attachAudioUnlockHandlers();
  }

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
    try {
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
      // Kamera deaktivieren, um Bandbreite zu sparen
      try { await this.setCameraEnabled(false); } catch {}
      for (const t of tracks) {
        await this.current.localParticipant.publishTrack(t);
        try {
          const mst: any = (t as any)?.mediaStreamTrack;
          if (mst && 'contentHint' in mst) {
            try { mst.contentHint = 'detail'; } catch {}
          }
          (t as any)?.setContentHint?.('detail');
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
      return true;
    } catch (e: any) {
      // Bei Abbruch/Verweigerung keinen Fehler werfen, sondern false zurück
      return false;
    }
  }

  async stopScreenshare() {
    if (!this.current) return;
    try {
      const pubs = Array.from(this.current.localParticipant.trackPublications.values());
      for (const pub of pubs) {
        const src = (pub as any).source || (pub.track as any)?.source;
        if (src && (src === 'screen_share' || src === 'screen_share_audio')) {
          try { await this.current.localParticipant.unpublishTrack(pub.track!); } catch {}
        }
      }
    } catch (e) {
      // Stop screenshare failed silently
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
    if (!this.current) {
      this.pendingMic = enabled;
      if (enabled) await this.ensurePermissions(true, false);
      return;
    }
    this.pendingMic = false; // Clear pending flag when we have a room
    try {
      const pubs = Array.from(this.current.localParticipant.trackPublications.values());
      const micPubs = (pubs as any[]).filter((pub: any) => {
        const src = (pub as any).source ?? (pub as any)?.track?.source;
        const kind = (pub as any).kind ?? (pub as any)?.track?.kind;
        return src === 'microphone' || src === 0 || src === 2 || kind === 'audio';
      });
      if (enabled) {
        // Stelle sicher, dass Audio-Wiedergabe freigeschaltet ist (User-Geste erforderlich)
        try { await (this.current as any)?.startAudio?.(); } catch {}
        if (micPubs.some(p => !!(p as any).track)) return; // already enabled
        const { createLocalTracks } = await import('livekit-client');
        const tracks = await createLocalTracks({ audio: this.preferredMic ? { deviceId: this.preferredMic, noiseSuppression: true, echoCancellation: true, autoGainControl: true } : { noiseSuppression: true, echoCancellation: true, autoGainControl: true } });
        for (const t of tracks) {
          if ((t as any).kind === 'audio') await this.current.localParticipant.publishTrack(t);
        }
      } else {
        for (const pub of micPubs) {
          try { await this.current.localParticipant.unpublishTrack(pub.track!); } catch {}
        }
      }
    } catch (e: any) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'NotFoundError')) {
        const ok = await this.ensurePermissions(true, false);
        if (ok && enabled) return this.setMicrophoneEnabled(true);
      }
      // setMicrophoneEnabled failed silently
    }
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (!this.current) {
      this.pendingCam = enabled;
      if (enabled) await this.ensurePermissions(false, true);
      return;
    }
    this.pendingCam = false; // Clear pending flag when we have a room
    try {
      const pubs = Array.from(this.current.localParticipant.trackPublications.values());
      const camPubs = (pubs as any[]).filter((pub: any) => {
        const src = (pub as any).source ?? (pub as any)?.track?.source;
        const kind = (pub as any).kind ?? (pub as any)?.track?.kind;
        return src === 'camera' || src === 1 || (kind === 'video' && src !== 'screen_share');
      });
      if (enabled) {
        if (camPubs.some(p => !!(p as any).track)) {
          return; // already enabled
        }
        const { createLocalTracks } = await import('livekit-client');
        const tracks = await createLocalTracks({ video: this.preferredCam ? { deviceId: this.preferredCam, facingMode: 'user' } : { facingMode: 'user' } });
        for (const t of tracks) {
          if ((t as any).kind === 'video') {
            try {
              await this.current.localParticipant.publishTrack(t);
            } catch (e) {
              throw e; // Re-throw to handle in UI
            }
          }
        }
      } else {
        for (const pub of camPubs) {
          try { await this.current.localParticipant.unpublishTrack(pub.track!); } catch {}
        }
      }
    } catch (e: any) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'NotFoundError')) {
        const ok = await this.ensurePermissions(false, true);
        if (ok && enabled) return this.setCameraEnabled(true);
      }
      // setCameraEnabled failed silently
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
