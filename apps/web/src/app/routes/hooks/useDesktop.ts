/**
 * useDesktop Hook
 *
 * Bindet Desktop-Features (Tauri) optional ein.
 * Im OSS-Build (ohne @meetropolis/desktop) gibt alles No-Op/false zurück.
 *
 * State-Sync mit dem Desktop-Modul erfolgt über Custom DOM Events:
 * - desktop:mini-mode-changed  (Detail: { isMiniMode: boolean })
 * - desktop:open-preferences
 *
 * Das Desktop-Modul setzt den State imperativ in initDesktop() auf
 * und dispatcht Events bei Änderungen. Kein React Hook im Desktop-Modul nötig.
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
  const [isMiniMode, setIsMiniMode] = useState(() => (window as any).__DESKTOP__?.isMiniMode ?? false);
  const [tauriPrefsOpen, setTauriPrefsOpen] = useState(false);

  // Lade Desktop-Modul
  useEffect(() => {
    let cancelled = false;
    getDesktopModule().then(mod => {
      if (cancelled || !mod) return;
      setDesktop(mod);
      setIsTauri(true);
      // Initialen Mini-Mode State lesen (wurde in initDesktop() gesetzt)
      setIsMiniMode((window as any).__DESKTOP__?.isMiniMode ?? false);
    });
    return () => { cancelled = true; };
  }, []);

  // Lausche auf Mini-Mode Änderungen via Custom DOM Events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.isMiniMode === 'boolean') {
        setIsMiniMode(detail.isMiniMode);
      }
    };
    window.addEventListener('desktop:mini-mode-changed', handler);
    return () => window.removeEventListener('desktop:mini-mode-changed', handler);
  }, []);

  const toggleMiniMode = useCallback(async () => {
    const toggle = (window as any).__DESKTOP__?.toggleMiniMode;
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
