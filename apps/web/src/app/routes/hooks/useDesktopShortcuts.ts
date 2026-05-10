import React from 'react';

type Params = {
  isTauri: boolean;
  toggleMiniMode: () => void;
  setTauriPrefsOpen: (v: boolean) => void;
};

/**
 * Wires Cmd/Ctrl+M to toggle mini mode and listens for the
 * `desktop:open-preferences` custom event dispatched by the desktop module.
 */
export function useDesktopShortcuts({ isTauri, toggleMiniMode, setTauriPrefsOpen }: Params) {
  React.useEffect(() => {
    if (!isTauri) return;
    const handleMiniModeKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        e.stopPropagation();
        toggleMiniMode();
      }
    };
    window.addEventListener('keydown', handleMiniModeKey, true);
    const handleOpenPrefs = () => setTauriPrefsOpen(true);
    window.addEventListener('desktop:open-preferences', handleOpenPrefs);
    return () => {
      window.removeEventListener('keydown', handleMiniModeKey, true);
      window.removeEventListener('desktop:open-preferences', handleOpenPrefs);
    };
  }, [isTauri, toggleMiniMode, setTauriPrefsOpen]);
}

/** Cmd/Ctrl+D to toggle mic. */
export function useMicShortcut(pttAwareToggleMic: (() => void | Promise<void>) | null) {
  React.useEffect(() => {
    if (!pttAwareToggleMic) return;
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        e.stopPropagation();
        void pttAwareToggleMic();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [pttAwareToggleMic]);
}
