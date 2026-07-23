import React from 'react';

type Params = {
  isTauri: boolean;
  toggleMiniMode: () => void;
};

/**
 * Wires Cmd/Ctrl+M to toggle mini mode. The `desktop:open-preferences` event
 * (native Cmd+, menu item) is handled by the AV toolbar, which opens the
 * unified audio/video settings dialog — the desktop no longer has a separate
 * preferences modal.
 */
export function useDesktopShortcuts({ isTauri, toggleMiniMode }: Params) {
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
    return () => {
      window.removeEventListener('keydown', handleMiniModeKey, true);
    };
  }, [isTauri, toggleMiniMode]);
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
