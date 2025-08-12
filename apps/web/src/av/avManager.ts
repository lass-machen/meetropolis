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
  private preferredMic?: string;
  private preferredCam?: string;
  private pendingMic = false;
  private pendingCam = false;

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
    await this.leave();
    this.current = await joinLivekitRoom({
      baseUrl: this.baseUrl,
      tokenEndpoint: '/livekit/token',
      roomName,
      identity: this.identity,
      useVideo: this.useVideo,
    });
    this.currentName = roomName;
    // Aktiviere ggf. gewünschte Tracks nach Connect
    try {
      if (this.pendingMic) await this.setMicrophoneEnabled(true);
      if (this.pendingCam) await this.setCameraEnabled(true);
    } catch {}
  }

  async leave() {
    if (this.current) {
      try { await this.current.disconnect(); } catch {}
    }
    this.current = undefined;
    this.currentName = null;
  }

  get activeRoom(): string | null {
    return this.currentName;
  }

  get room(): Room | undefined {
    return this.current;
  }

  async startScreenshare() {
    if (!this.current) return;
    try {
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
        const src = (pub as any).source || (pub.track as any)?.source;
        return src === 'microphone';
      });
      if (enabled) {
        if (micPubs.length > 0) return; // already enabled
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
        const src = (pub as any).source || (pub.track as any)?.source;
        return src === 'camera';
      });
      if (enabled) {
        if (camPubs.length > 0) return; // already enabled
        const { createLocalTracks } = await import('livekit-client');
        const tracks = await createLocalTracks({ video: this.preferredCam ? { deviceId: this.preferredCam } : true });
        for (const t of tracks) {
          if ((t as any).kind === 'video') await this.current.localParticipant.publishTrack(t);
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
    await this.setMicrophoneEnabled(false);
    await this.setMicrophoneEnabled(true);
  }

  async useCameraDevice(deviceId: string) {
    this.preferredCam = deviceId;
    if (!this.current) return;
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
