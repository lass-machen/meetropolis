import type { Room } from 'livekit-client';

export type AVControllerOptions = {
  baseUrl: string;
  identity: string;
  displayName: string;
  useVideo: boolean;
};

export class AVController {
  private _room: Room | undefined;
  private _state: 'idle' | 'connecting' | 'connected' | 'publishing' | 'subscribed' | 'reconnecting' | 'closed' | 'error' = 'idle';
  private _pageLeaving = false;
  private _disconnecting = false;
  private _reconnectAttempts = 0;
  private _reconnectTimer: any = null;

  constructor(_options: AVControllerOptions) {
    // options parameter kept for API compatibility
  }

  get room(): Room | undefined {
    return this._room;
  }

  setRoom(room: Room | undefined) {
    this._room = room;
  }

  get state() { return this._state; }
  setState(next: typeof this._state) { this._state = next; }
  setPageLeaving(leaving: boolean) { this._pageLeaving = !!leaving; }
  setDisconnecting(disconnecting: boolean) { this._disconnecting = !!disconnecting; }
  resetReconnect() { this._reconnectAttempts = 0; try { if (this._reconnectTimer) clearTimeout(this._reconnectTimer); } catch {}; this._reconnectTimer = null; }

  shouldScheduleReconnect(): boolean {
    if (this._pageLeaving) return false;
    if (this._disconnecting) return false;
    return true;
  }

  scheduleReconnect(switchTo: (name: string) => Promise<void>, getCurrentRoomName: () => string | null): void {
    if (!this.shouldScheduleReconnect()) return;
    const attempt = ++this._reconnectAttempts;
    const delay = Math.min(30000, 1000 * Math.pow(2, attempt - 1) + Math.random() * 500);
    try { if (this._reconnectTimer) clearTimeout(this._reconnectTimer); } catch {}
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      const name = getCurrentRoomName();
      if (!name) return;
      void switchTo(name).catch(() => this.scheduleReconnect(switchTo, getCurrentRoomName));
    }, delay);
  }
}


