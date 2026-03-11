import { useEffect } from 'react';
import { logger } from '../../../lib/logger';

interface UseTauriEffectsParams {
  isTauri: boolean;
  isMiniMode: boolean;
  toggleMiniMode: () => void;
  onOpenPreferences: () => void;
}

export function useTauriEffects(params: UseTauriEffectsParams) {
  const { isTauri, toggleMiniMode, onOpenPreferences } = params;

  // Cmd+M keyboard shortcut to toggle mini mode
  useEffect(() => {
    if (!isTauri) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        e.stopPropagation();
        toggleMiniMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isTauri, toggleMiniMode]);

  // Listen for native menu "open-preferences" event
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('open-preferences', () => {
          onOpenPreferences();
        });
      } catch (e) {
        logger.warn('[Tauri] Failed to setup open-preferences listener:', e);
      }
    };
    setup();
    return () => { unlisten?.(); };
  }, [isTauri, onOpenPreferences]);
}
