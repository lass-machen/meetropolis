import { Room } from 'livekit-client';
import { joinLivekitRoom } from '../lib/livekit';

export class AVManager {
  private current: Room | undefined;
  private currentName: string | null = null;
  private readonly baseUrl: string;
  private readonly identity: string;
  private readonly useVideo: boolean;

  constructor(opts: { baseUrl: string; identity: string; useVideo: boolean }) {
    this.baseUrl = opts.baseUrl;
    this.identity = opts.identity;
    this.useVideo = opts.useVideo;
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
}
