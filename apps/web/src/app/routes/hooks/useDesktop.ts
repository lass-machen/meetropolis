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
  tauriPrefsOpen: boolean;
  setTauriPrefsOpen: (open: boolean) => void;
  desktop: DesktopModule | null;
}

const noopAsync = async () => {};

export function useDesktop(): DesktopState {
  const [desktop, setDesktop] = useState<DesktopModule | null>(null);
  const [isTauri, setIsTauri] = useState(false);
  const [isMiniMode, setIsMiniMode] = useState(() => window.__DESKTOP__?.isMiniMode ?? false);
  const [tauriPrefsOpen, setTauriPrefsOpen] = useState(false);

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

  return {
    isTauri,
    isMiniMode,
    toggleMiniMode: isTauri ? toggleMiniMode : noopAsync,
    tauriPrefsOpen,
    setTauriPrefsOpen,
    desktop,
  };
}
