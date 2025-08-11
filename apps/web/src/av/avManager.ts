import { Room } from 'livekit-client';
import { joinLivekitRoom } from '../lib/livekit';

export class AVManager {
  private current?: Room;
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

  get activeRoom() {
    return this.currentName;
  }
}

