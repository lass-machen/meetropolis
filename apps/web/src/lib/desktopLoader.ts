/**
 * Desktop Module Loader (Conditional Loading Pattern)
 *
 * Analogon zu tenancyLoader.ts auf dem Server.
 * Versucht @meetropolis/desktop per Dynamic Import zu laden.
 * Falls das Modul fehlt (OSS-Build ohne Submodule) → graceful null/No-Op.
 */

import type { ComponentType } from 'react';

export interface DesktopModule {
  /** Initialisiert Desktop-Bridge (Config laden, window.desktop setzen) */
  initDesktop: () => void;
  /** Wartet bis die Desktop-Config geladen ist */
  waitForConfig: () => Promise<void>;
  /** Mini-Mode View Component */
  MiniModeView: ComponentType<any>;
  /** Tauri Preferences Modal Component */
  TauriPreferencesModal: ComponentType<{ open: boolean; onOpenChange: (v: boolean) => void }>;
  /** URL in externem Browser öffnen (via Tauri Shell Plugin) */
  openExternal: (url: string) => Promise<void>;
  /** Auth-Token setzen (für Tauri-Clients die keine Cookies nutzen können) */
  setDesktopAuthToken: (token: string | null) => void;
}

let cached: DesktopModule | null | undefined = undefined; // undefined = not yet tried

/**
 * Lädt das Desktop-Modul falls vorhanden.
 * Gibt null zurück wenn das Modul nicht verfügbar ist (OSS-Build).
 */
export async function getDesktopModule(): Promise<DesktopModule | null> {
  if (cached !== undefined) return cached;

  try {
    // @ts-expect-error — @meetropolis/desktop ist ein optionales privates Submodule.
    // Im OSS-Build existiert es nicht, der Import schlägt dann fehl → catch.
    const mod: any = await import('@meetropolis/desktop');
    const resolved = mod.default ?? mod;
    // Validierung: Prüfe ob das Modul tatsächlich Desktop-Features exportiert.
    // Im OSS-Build (ohne Submodule) liefert das Vite-Plugin ein leeres Modul (null).
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
 * Synchroner Check ob wir in einer Desktop-Umgebung laufen.
 * Prüft window.__MEETROPOLIS_API_BASE__ oder window.desktop (generisch, nicht Tauri-spezifisch).
 */
export function isDesktopEnvironment(): boolean {
  try {
    const w = window as any;
    return !!(w.__TAURI__ || w.desktop?.apiBase || w.__MEETROPOLIS_API_BASE__);
  } catch {
    return false;
  }
}
