// Global type definitions for the Meetropolis web application

import type { Room as LiveKitRoom, LocalParticipant, RemoteParticipant, Track } from 'livekit-client';
import type { Room as ColyseusRoom } from 'colyseus.js';

// W3C Audio Session API (Safari 16.4+ / WKWebView)
// https://w3c.github.io/audio-session/
interface AudioSession {
  type: 'auto' | 'playback' | 'play-and-record' | 'transient' | 'ambient';
}

declare global {
  interface Navigator {
    audioSession?: AudioSession;
  }
  interface Window {
    // Phaser Scene Reference
    currentPhaserScene?: Phaser.Scene & {
      setAssetPreview?: (asset: unknown) => void;
      cameras?: {
        main?: {
          pan?: (x: number, y: number, duration: number, ease: string) => void;
        };
      };
    };

    // Runtime Configuration
    __MEETROPOLIS_API_BASE__?: string;
    __map_name?: string;
    MAP_NAME?: string;

    // Desktop Integration (Tauri)
    desktop?: {
      apiBase?: string;
      beginActivityAssertion?: (reason: string) => Promise<boolean>;
      endActivityAssertion?: () => Promise<boolean>;
    };

    // Player Position Management
    initialPlayerPosition?: { x: number; y: number };

    // Session Management
    __localSessionId?: string;
    __wsReconnects?: number;
    __sessionConflictPending?: boolean;

    // Editor State
    pendingTilesets?: Array<{
      key: string;
      dataUrl: string;
      tileWidth: number;
      tileHeight: number;
      margin?: number;
      spacing?: number;
      category?: string;
    }>;
  }
}

// Type Guards for LiveKit Types
export function isLiveKitRoom(room: unknown): room is LiveKitRoom {
  return !!room && typeof room === 'object' && 'localParticipant' in room;
}

export function isLocalParticipant(participant: unknown): participant is LocalParticipant {
  return !!participant && typeof participant === 'object' && 'publishTrack' in participant;
}

export function isRemoteParticipant(participant: unknown): participant is RemoteParticipant {
  return !!participant && typeof participant === 'object' && 'trackPublications' in participant;
}

export function isTrack(track: unknown): track is Track {
  return !!track && typeof track === 'object' && 'kind' in track;
}

// Type Guards for Colyseus Types
export function isColyseusRoom(room: unknown): room is ColyseusRoom {
  return !!room && typeof room === 'object' && 'sessionId' in room && 'send' in room;
}

export {};
