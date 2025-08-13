const DEBUG = (import.meta as any).env?.VITE_DEBUG_LOGS === 'true';
const SIMPLE = (import.meta as any).env?.VITE_AV_SIMPLE === 'true';
const ALLOW_RECONNECT = (import.meta as any).env?.VITE_AV_RECONNECT !== 'false';
import { Room } from 'livekit-client';
import { joinLivekitRoom } from '../lib/livekit';

export type AVDevices = {
  microphones: { deviceId: string; label: string }[];
  cameras: { deviceId: string; label: string }[];
};

export class AVManager {
  private current: Room | undefined;
  private currentName: string | null = null;
  private readonly baseUrl: string;
  private readonly identity: string;
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

  constructor(opts: { baseUrl: string; identity: string; useVideo: boolean }) {
    this.baseUrl = opts.baseUrl;
    this.identity = opts.identity;
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
        useVideo: this.useVideo,
      });
      if (seq !== this.connectSeq) { try { await room.disconnect(); } catch {} return; }
      this.current = room;
      this.currentName = name;
      this.reconnectAttempts = 0;
      this.wireRoomEvents();
      if (!SIMPLE) {
        await this.waitForConnected(room).catch(()=>{});
      }
    } finally {
      this.isConnecting = false;
    }
    // Tracks aktivieren
    if (SIMPLE) {
      try { if (this.pendingMic) await this.setMicrophoneEnabled(true); } catch {}
      try { if (this.pendingCam) await this.setCameraEnabled(true); } catch {}
    } else {
      setTimeout(async () => {
        if (!this.current) return;
        try { if (this.pendingMic) await this.setMicrophoneEnabled(true); } catch {}
        try { if (this.pendingCam) await this.setCameraEnabled(true); } catch {}
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

  setParticipantVolume(sid: string, volume: number) {
    const room = this.current;
    if (!room) return;
    try {
      const participants = (room as any).remoteParticipants || (room as any).participants;
      const p = participants?.get?.(sid);
      if (!p) return;
      const pubs: any[] = Array.from((p.trackPublications?.values?.() || []) as any);
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
        if (RoomEvent) {
          room.off?.(RoomEvent.Reconnected, () => {});
          room.off?.(RoomEvent.Disconnected, () => {});
          room.on?.(RoomEvent.Reconnected, () => { this.reconnectAttempts = 0; });
          room.on?.(RoomEvent.Disconnected, () => { if (ALLOW_RECONNECT && !this.isDisconnecting) this.scheduleReconnect(); });
        } else {
          const r: any = room as any;
          r.off?.('reconnected', () => {});
          r.off?.('disconnected', () => {});
          r.on?.('reconnected', () => { this.reconnectAttempts = 0; });
          r.on?.('disconnected', () => { if (ALLOW_RECONNECT && !this.isDisconnecting) this.scheduleReconnect(); });
        }
      } catch {
        // Fallback: wenn Event-Konstanten fehlen, zumindest einmal versuchen
        this.scheduleReconnect();
      }
    })();
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

  async startScreenshare() {
    if (!this.current) return;
    try {
      await this.waitForConnected(this.current).catch(()=>{});
      const { createLocalScreenTracks } = await import('livekit-client');
      const tracks = await createLocalScreenTracks({});
      for (const t of tracks) await this.current.localParticipant.publishTrack(t);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('screenshare failed', e);
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
      // eslint-disable-next-line no-console
      console.warn('stop screenshare failed', e);
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
      // eslint-disable-next-line no-console
      console.warn('permission request failed', e);
      return false;
    }
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (!this.current) {
      this.pendingMic = enabled;
      if (enabled) await this.ensurePermissions(true, false);
      return;
    }
    try {
      const pubs = Array.from(this.current.localParticipant.trackPublications.values());
      const micPubs = pubs.filter(pub => {
        const src = (pub as any).source ?? (pub.track as any)?.source;
        const kind = (pub as any).kind ?? (pub.track as any)?.kind;
        return src === 'microphone' || src === 0 || kind === 'audio';
      });
      if (enabled) {
        if (micPubs.some(p => !!(p as any).track)) return; // already enabled
        const { createLocalTracks } = await import('livekit-client');
        const tracks = await createLocalTracks({ audio: this.preferredMic ? { deviceId: this.preferredMic } : true });
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
      // eslint-disable-next-line no-console
      console.warn('setMicrophoneEnabled failed', e);
    }
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (!this.current) {
      this.pendingCam = enabled;
      if (enabled) await this.ensurePermissions(false, true);
      return;
    }
    try {
      const pubs = Array.from(this.current.localParticipant.trackPublications.values());
      const camPubs = pubs.filter(pub => {
        const src = (pub as any).source ?? (pub.track as any)?.source;
        const kind = (pub as any).kind ?? (pub.track as any)?.kind;
        return src === 'camera' || src === 1 || kind === 'video';
      });
      if (enabled) {
        if (camPubs.some(p => !!(p as any).track)) return; // already enabled
        const { createLocalTracks } = await import('livekit-client');
        const tracks = await createLocalTracks({ video: this.preferredCam ? { deviceId: this.preferredCam } : true });
        if (DEBUG) { try { console.log('[AV] createLocalTracks(video) ->', tracks.map(t => ({ kind: (t as any).kind, id: (t as any)?.mediaStreamTrack?.id }))); } catch {} }
        for (const t of tracks) {
          if ((t as any).kind === 'video') {
            try {
              await this.current.localParticipant.publishTrack(t);
              if (DEBUG) { try { console.log('[AV] published local video track'); } catch {} }
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn('[AV] publish video failed', e);
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
      // eslint-disable-next-line no-console
      console.warn('setCameraEnabled failed', e);
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
    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices
      .filter(d => d.kind === 'audioinput')
      .map(d => ({ deviceId: d.deviceId, label: d.label || 'Microphone' }));
    const cameras = devices
      .filter(d => d.kind === 'videoinput')
      .map(d => ({ deviceId: d.deviceId, label: d.label || 'Camera' }));
    return { microphones, cameras };
  }
}
