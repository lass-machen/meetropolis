/**
 * Desktop module loader (conditional loading pattern).
 *
 * Counterpart to tenancyLoader.ts on the server. Tries to load
 * @meetropolis/desktop via dynamic import. When the module is missing
 * (OSS build without the private submodule) the loader falls back to a
 * graceful null result so callers stay no-op.
 */

import type { ComponentType } from 'react';

export interface DesktopModule {
  /** Initialise the desktop bridge (load config, set window.desktop). */
  initDesktop: () => void;
  /** Resolve once the desktop config has been loaded. */
  waitForConfig: () => Promise<void>;
  /** Mini-mode view component. */
  MiniModeView: ComponentType<any>;
  /** Tauri preferences modal component. */
  TauriPreferencesModal: ComponentType<{ open: boolean; onOpenChange: (v: boolean) => void }>;
  /** Update banner component (renders update notifications). */
  UpdateBanner: ComponentType<Record<string, never>>;
  /** Open a URL in the external browser via the Tauri shell plugin. */
  openExternal: (url: string) => Promise<void>;
  /** Set the auth token used by Tauri clients that cannot rely on cookies. */
  setDesktopAuthToken: (token: string | null) => void;
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
    const mod: any = await import('@meetropolis/desktop');
    const resolved = mod.default ?? mod;
    // Confirm the module actually exposes desktop features.
    // In OSS builds (no submodule) the Vite plugin returns an empty module (null).
    if (!resolved || typeof resolved.initDesktop !== 'function') {
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
    const w = window as any;
    return !!(w.__TAURI__ || w.desktop?.apiBase || w.__MEETROPOLIS_API_BASE__);
  } catch {
    return false;
  }
}
