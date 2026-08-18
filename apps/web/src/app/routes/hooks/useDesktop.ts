/**
 * useDesktop hook.
 *
 * Optionally binds desktop features (Tauri). In OSS builds (without
 * @meetropolis/desktop) every value falls back to a no-op or `false`.
 *
 * State sync with the desktop module is performed via custom DOM events:
 * - desktop:mini-mode-changed (detail: { isMiniMode: boolean })
 * - desktop:open-preferences
 *
 * The desktop module sets the state imperatively in initDesktop() and
 * dispatches events on changes, so no React hook is needed inside the
 * desktop module itself.
 */

import { useState, useEffect, useCallback } from 'react';
import { getDesktopModule, type DesktopModule } from '../../../lib/desktopLoader';

export interface DesktopState {
  isTauri: boolean;
  isMiniMode: boolean;
  toggleMiniMode: () => Promise<void>;
  /**
   * Report whether the world is on screen (see useMiniModeAuthGuard). The
   * desktop side derives the window mode from it and leaves the user's
   * preference alone. A no-op wherever the bridge is absent, which covers both
   * a plain browser and a desktop build older than the command.
   */
  setWorldVisible: (visible: boolean) => Promise<void>;
  desktop: DesktopModule | null;
}

const noopAsync = async () => {};

export function useDesktop(): DesktopState {
  const [desktop, setDesktop] = useState<DesktopModule | null>(null);
  const [isTauri, setIsTauri] = useState(false);
  const [isMiniMode, setIsMiniMode] = useState(() => window.__DESKTOP__?.isMiniMode ?? false);

  // Load the desktop module.
  useEffect(() => {
    let cancelled = false;
    void getDesktopModule().then((mod) => {
      if (cancelled || !mod) return;
      setDesktop(mod);
      setIsTauri(true);
      // Read the initial mini-mode state (set by initDesktop()).
      setIsMiniMode(window.__DESKTOP__?.isMiniMode ?? false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Listen for mini-mode changes via custom DOM events.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ isMiniMode?: boolean }>).detail;
      if (detail && typeof detail.isMiniMode === 'boolean') {
        setIsMiniMode(detail.isMiniMode);
      }
    };
    window.addEventListener('desktop:mini-mode-changed', handler);
    return () => window.removeEventListener('desktop:mini-mode-changed', handler);
  }, []);

  const toggleMiniMode = useCallback(async () => {
    const toggle = window.__DESKTOP__?.toggleMiniMode;
    if (typeof toggle === 'function') await toggle();
  }, []);

  // Deliberately not gated on isTauri, and therefore stable for the whole
  // lifetime of the consumer: the guard's effect depends on this function, and
  // an identity that changes would re-run the effect on unrelated re-renders.
  // The guard against calling into a bridge that is not there is the absent
  // window.__DESKTOP__ itself — that is also what protects a desktop build older
  // than the set_world_visible command.
  const setWorldVisible = useCallback(async (visible: boolean) => {
    const report = window.__DESKTOP__?.setWorldVisible;
    if (typeof report !== 'function') return;
    await report(visible);
  }, []);

  return {
    isTauri,
    isMiniMode,
    toggleMiniMode: isTauri ? toggleMiniMode : noopAsync,
    setWorldVisible,
    desktop,
  };
}
