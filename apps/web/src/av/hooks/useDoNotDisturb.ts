/**
 * useDoNotDisturb Hook
 *
 * Simplified DND hook that integrates with gameBridge.
 * This replaces both useDoNotDisturbBridge and useDndShortcut.
 */

import React from 'react';
import type { AVManager } from '../avManager';
import { gameBridge } from '../../game/bridge';
import { logger } from '../../lib/logger';

interface UseDNDArgs {
  enabled: boolean;
  avRef: React.MutableRefObject<AVManager | null>;
  dndRef: React.MutableRefObject<boolean>;
  setAvState: React.Dispatch<React.SetStateAction<{ mic: boolean; cam: boolean; share: boolean; dnd: boolean }>>;
  colyseusRef?: React.MutableRefObject<any>;
}

export function useDoNotDisturb({
  enabled,
  avRef,
  dndRef,
  setAvState,
  colyseusRef,
}: UseDNDArgs) {
  // Install gameBridge interceptor
  React.useEffect(() => {
    const gb = gameBridge as any;
    const originalSetDnd = gb.setDoNotDisturb;

    if (typeof originalSetDnd !== 'function') return;

    // Override gameBridge.setDoNotDisturb to sync with AVManager
    gb.setDoNotDisturb = async (nextEnabled: boolean) => {
      // 1) Apply game-side effects immediately (movement lock, etc.)
      try { originalSetDnd?.(!!nextEnabled); } catch {}

      // 2) Update UI immediately (do not block on AV operations)
      dndRef.current = nextEnabled;
      setAvState((s) => ({
        ...s,
        dnd: nextEnabled,
        mic: nextEnabled ? false : s.mic,
        cam: nextEnabled ? false : s.cam,
        share: nextEnabled ? false : s.share,
      }));

      // 3) Notify Colyseus (best-effort)
      try { colyseusRef?.current?.send?.('dnd_status', { dnd: nextEnabled }); } catch {}

      // 4) Sync with AVManager in background (best-effort)
      try { void avRef.current?.setDoNotDisturb(nextEnabled); } catch {}
    };

    return () => {
      try {
        gb.setDoNotDisturb = originalSetDnd;
      } catch {}
    };
  }, [avRef, dndRef, setAvState, colyseusRef]);

  // Keyboard shortcut: Ctrl+Shift+U or Cmd+Shift+U
  React.useEffect(() => {
    if (!enabled) return;

    const handleKeydown = async (e: KeyboardEvent) => {
      const isShortcut =
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === 'U' || e.key === 'u');

      if (!isShortcut) return;

      e.preventDefault();

      // Get current DND state from AVManager (single source of truth)
      const currentDnd = !!(avRef.current as any)?.dndEnabled;
      const nextDnd = !currentDnd;

      logger.debug('[DND] Shortcut toggle:', { currentDnd, nextDnd });

      // Use gameBridge to trigger the full flow
      try {
        (gameBridge as any).setDoNotDisturb(nextDnd);
        (gameBridge as any).setMovementLocked?.(nextDnd);
      } catch {}
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [enabled, avRef]);
}

/**
 * Standalone toggle function for use outside React
 */
export async function toggleDoNotDisturb(
  avRef: React.MutableRefObject<AVManager | null>
): Promise<boolean> {
  const av = avRef.current;
  if (!av) return false;

  const currentDnd = (av as any).dndEnabled;
  const nextDnd = !currentDnd;

  await av.setDoNotDisturb(nextDnd);

  try {
    (gameBridge as any).setDoNotDisturb?.(nextDnd);
    (gameBridge as any).setMovementLocked?.(nextDnd);
  } catch {}

  return nextDnd;
}
