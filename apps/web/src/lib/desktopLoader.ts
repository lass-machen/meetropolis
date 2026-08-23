/**
 * Desktop module loader (conditional loading pattern).
 *
 * Counterpart to tenancyLoader.ts on the server. Tries to load
 * @meetropolis/desktop via dynamic import. When the module is missing
 * (OSS build without the private submodule) the loader falls back to a
 * graceful null result so callers stay no-op.
 */

import type { ComponentType } from 'react';
import type { Room } from 'livekit-client';
import type { UiParticipant } from '../types/participant';
import type { Position } from '../types/game';

/** One row of the presence roster as the mini window consumes it. */
export interface MiniModeRosterItem {
  /** LiveKit identity (the user id), the same key `UiParticipant.livekitIdentity` uses. */
  identity: string;
  name: string;
  online: boolean;
  x?: number;
  y?: number;
  lastSeen?: string;
}

/**
 * Props of the desktop mini window.
 *
 * Declared concretely, not as `Record<string, unknown>`. The loose shape let a
 * rename inside `UiParticipant` land in the submodule uncaught: the mini
 * window kept reading a field that no longer existed and crashed on its first
 * camera tile, while typecheck, lint and the web test suite stayed green. The
 * types the submodule consumes are exported from the OSS side so it can import
 * them instead of restating them (see `meetropolis-desktop`
 * `src/routes/components/MiniModeView.tsx`).
 *
 * `onToggle*` are `void | Promise<void>` on purpose: DND toggles synchronously
 * while the device toggles are async.
 */
export interface MiniModeViewProps {
  roster: MiniModeRosterItem[];
  uiParticipants: UiParticipant[];
  /**
   * The viewer's own LiveKit identity (their user id), the key their roster row
   * carries.
   *
   * The mini window lists the online roster rows that have no participant card
   * yet, and the viewer always has a card. Matching that card by identity fails
   * in exactly one case: without a LiveKit room `buildFallbackList`
   * (`features/participants/useParticipants.ts`) builds the local tile with an
   * empty `livekitIdentity`, because there is no LiveKit participant to bind it
   * to. This field closes that gap by identity instead of by display name, so
   * a colleague of the same name keeps their entry.
   */
  meIdentity: string;
  avState: { mic: boolean; cam: boolean; share: boolean; dnd: boolean };
  /** Label for a LiveKit identity. Never a lookup key — see `UiParticipant`. */
  getDisplayName: (identity: string) => string;
  onJumpTo: (item: { x?: number; y?: number }) => void;
  onToggleMic: () => void | Promise<void>;
  onToggleCam: () => void | Promise<void>;
  onToggleDnd: () => void | Promise<void>;
  onToggleShare: () => void | Promise<void>;
  onExpand: () => void;
  onExpandWithScreen: (screenSid: string) => void;
  roomGetter: () => Room | undefined;
  getZones: () => Array<{ name: string; points: Position[] }>;
}

export interface DesktopModule {
  /** Initialise the desktop bridge (load config, set window.desktop). */
  initDesktop: () => void;
  /** Resolve once the desktop config has been loaded. */
  waitForConfig: () => Promise<void>;
  /** Mini-mode view component. Props contract: `MiniModeViewProps`. */
  MiniModeView: ComponentType<MiniModeViewProps>;
  /** Tauri preferences modal component. */
  TauriPreferencesModal: ComponentType<{ open: boolean; onOpenChange: (v: boolean) => void }>;
  /** Update banner component (renders update notifications). */
  UpdateBanner: ComponentType<Record<string, never>>;
  /** Open a URL in the external browser via the Tauri shell plugin. */
  openExternal: (url: string) => Promise<void>;
  /** Set the auth token used by Tauri clients that cannot rely on cookies. */
  setDesktopAuthToken: (token: string | null) => void;
  /**
   * Read back the currently stored native auth token, if any. Used to
   * present the JWT explicitly on the Colyseus world join (see
   * apps/web/src/lib/colyseus.ts joinWorld / rooms/lifecycle/onAuth.ts on
   * the server) since a `tauri://` origin has no cross-site auth cookie.
   * Optional: older desktop module builds without this method simply mean
   * the OSS join path falls back to cookie-only auth (fails closed there,
   * as intended prior to a desktop-module update).
   */
  getDesktopAuthToken?: () => string | null;
  /** Read the current native audio-ducking preference (macOS only; false elsewhere). */
  getAudioDucking?: () => Promise<boolean>;
  /** Set the native audio-ducking preference. No-op on non-macOS desktop builds. */
  setAudioDucking?: (enabled: boolean) => Promise<void>;
}

let cached: DesktopModule | null | undefined = undefined; // undefined = not yet tried

/**
 * Load the desktop module when available.
 * Returns null when the module is missing (OSS build).
 */
export async function getDesktopModule(): Promise<DesktopModule | null> {
  if (cached !== undefined) return cached;

  try {
    // @meetropolis/desktop is an optional private submodule.
    // In OSS builds it is absent, so the import throws and lands in catch.
    const mod = (await import('@meetropolis/desktop')) as unknown as {
      default?: unknown;
      initDesktop?: unknown;
    };
    const resolved: unknown = mod.default ?? mod;
    // Confirm the module actually exposes desktop features.
    // In OSS builds (no submodule) the Vite plugin returns an empty module (null).
    if (
      !resolved ||
      typeof resolved !== 'object' ||
      typeof (resolved as { initDesktop?: unknown }).initDesktop !== 'function'
    ) {
      cached = null;
      return null;
    }
    cached = resolved as DesktopModule;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

/**
 * Synchronous check for desktop runtime context.
 * Inspects window.__MEETROPOLIS_API_BASE__ or window.desktop in a way that
 * stays generic and does not depend on Tauri internals.
 */
export function isDesktopEnvironment(): boolean {
  try {
    return !!(window.__TAURI__ || window.desktop?.apiBase || window.__MEETROPOLIS_API_BASE__);
  } catch {
    return false;
  }
}
