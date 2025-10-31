import type { Room } from 'livekit-client';

export type AVControllerOptions = {
  baseUrl: string;
  identity: string;
  displayName: string;
  useVideo: boolean;
};

// Minimaler Gerüst-Controller. In späteren Schritten wird die Logik hierher verlagert.
export class AVController {
  private readonly options: AVControllerOptions;
  private _room: Room | undefined;

  constructor(options: AVControllerOptions) {
    this.options = options;
  }

  get room(): Room | undefined {
    return this._room;
  }

  setRoom(room: Room | undefined) {
    this._room = room;
  }
}


