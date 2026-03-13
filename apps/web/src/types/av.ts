// Audio/Video type definitions

import type { Room as LiveKitRoom } from 'livekit-client';

export interface AVManager {
  room: LiveKitRoom | null;
  setMicrophoneEnabled(enabled: boolean): Promise<void>;
  setCameraEnabled(enabled: boolean): Promise<void>;
  startScreenshare(): Promise<boolean>;
  stopScreenshare(): Promise<void>;
  setDoNotDisturb(enabled: boolean): Promise<void>;
  useMicrophoneDevice(deviceId: string): Promise<void>;
  useCameraDevice(deviceId: string): Promise<void>;
  setParticipantVolume(identity: string, volume: number): void;
  leave(): Promise<void>;
}

export interface AVState {
  mic: boolean;
  cam: boolean;
  share: boolean;
  dnd: boolean;
}

export interface Device {
  id: string;
  label: string;
}

export interface Devices {
  mics: Device[];
  cams: Device[];
}
