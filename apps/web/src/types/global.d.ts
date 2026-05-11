// Global type definitions for the Meetropolis web application

import type { Room as LiveKitRoom, LocalParticipant, RemoteParticipant, Track } from 'livekit-client';
import type { Room as ColyseusRoom } from '@colyseus/sdk';
import type { V2State } from '../lib/mapV2';

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
    currentPhaserScene?:
      | (Phaser.Scene & {
          setAssetPreview?: (asset: unknown) => void;
          cameras?: {
            main?: {
              pan?: (x: number, y: number, duration: number, ease: string) => void;
            };
          };
        })
      | undefined;

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
    pendingTilesets?:
      | Array<{
          key: string;
          dataUrl: string;
          tileWidth: number;
          tileHeight: number;
          margin?: number;
          spacing?: number;
          category?: string;
        }>
      | undefined;

    // V2 map preload (pre-Phaser-init server-state cache)
    __v2_state?: V2State;

    // Web-base override for Tauri Desktop (when window.location.host is localhost)
    __MEETROPOLIS_WEB_BASE__?: string;

    // Phaser game reference (debug/integration)
    __PHASER_GAME__?: unknown;
    __DESKTOP__?: {
      isMiniMode?: boolean;
      toggleMiniMode?: () => void | Promise<void>;
      [key: string]: unknown;
    };

    // AV-Debug-Flags (only set when VITE_AV_DEBUG=true or programmatically)
    __avDebugOn?: boolean;
    __avLoggerInstalled?: boolean;
    __avLastApply?: { n: number; key: string };
    // Set by `../av/AVLogger.ts` for runtime debugging from the devtools
    // console (e.g. `window.avLogger.getEntries({ level: 'warn' })`). The
    // concrete type is `AVLoggerImpl`, but referencing it here would create
    // an ambient-vs-module import cycle. Typed as `unknown` because no
    // production code reads this; tooling that does interact with it casts
    // at the call site.
    avLogger?: unknown;
    DEBUG_LOGS?: boolean;

    // i18next runtime instance (for legacy non-react access via window)
    i18next?: { t?: (key: string, opts?: Record<string, unknown>) => string } | undefined;

    // Audio fallback when autoplay is blocked
    pendingAudioTracks?: Array<{
      track: unknown;
      audio: HTMLAudioElement;
      participantId: string;
    }>;

    // Safari prefix audio context (only set in older WebKit)
    webkitAudioContext?: typeof AudioContext;
    AudioWorkletNode?: typeof AudioWorkletNode;

    // Correlation id cached on the window for AV / API request tracing.
    __corrSessionId?: string;

    // Tauri runtime presence flag (set by the Tauri webview, absent in browsers).
    __TAURI__?: unknown;
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
