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
import type { WorldRoom } from '../../types/colyseus';

interface UseDNDArgs {
  enabled: boolean;
  avRef: React.MutableRefObject<AVManager | null>;
  dndRef: React.MutableRefObject<boolean>;
  setAvState: React.Dispatch<React.SetStateAction<{ mic: boolean; cam: boolean; share: boolean; dnd: boolean }>>;
  colyseusRef?: React.MutableRefObject<WorldRoom | null>;
}

export function useDoNotDisturb({ enabled, avRef, dndRef, setAvState, colyseusRef }: UseDNDArgs) {
  // Install gameBridge interceptor
  React.useEffect(() => {
    const originalSetDnd = gameBridge.setDoNotDisturb;

    if (typeof originalSetDnd !== 'function') return;

    // Override gameBridge.setDoNotDisturb to sync with AVManager.
    // Returns a Promise (keeps the interface thenable for awaiting callers)
    // without using `await` internally: AV sync is intentionally fire-and-forget.
    // GameBridge declares the method with a `void` return so we widen the
    // assignment site to accept a thenable shim used as a hook only.
    const wrapped = (nextEnabled: boolean): void => {
      // 1) Apply game-side effects immediately (movement lock, etc.)
      try {
        originalSetDnd(!!nextEnabled);
      } catch {}

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
      try {
        colyseusRef?.current?.send?.('dnd_status', { dnd: nextEnabled });
      } catch {}

      // 4) Sync with AVManager in background (best-effort)
      try {
        void avRef.current?.setDoNotDisturb(nextEnabled);
      } catch {}
    };
    gameBridge.setDoNotDisturb = wrapped;

    return () => {
      try {
        gameBridge.setDoNotDisturb = originalSetDnd;
      } catch {}
    };
  }, [avRef, dndRef, setAvState, colyseusRef]);

  // Keyboard shortcut: Ctrl+Shift+U or Cmd+Shift+U
  React.useEffect(() => {
    if (!enabled) return;

    const handleKeydown = (e: KeyboardEvent) => {
      const isShortcut = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'U' || e.key === 'u');

      if (!isShortcut) return;

      e.preventDefault();

      // Get current DND state from AVManager (single source of truth).
      const currentDnd = !!avRef.current?.dndEnabled;
      const nextDnd = !currentDnd;

      logger.debug('[DND] Shortcut toggle:', { currentDnd, nextDnd });

      // Use gameBridge to trigger the full flow
      try {
        gameBridge.setDoNotDisturb(nextDnd);
        gameBridge.setMovementLocked?.(nextDnd);
      } catch {}
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [enabled, avRef]);
}

/**
 * Standalone toggle function for use outside React
 */
export async function toggleDoNotDisturb(avRef: React.MutableRefObject<AVManager | null>): Promise<boolean> {
  const av = avRef.current;
  if (!av) return false;

  const currentDnd = av.dndEnabled;
  const nextDnd = !currentDnd;

  await av.setDoNotDisturb(nextDnd);

  try {
    gameBridge.setDoNotDisturb?.(nextDnd);
    gameBridge.setMovementLocked?.(nextDnd);
  } catch {}

  return nextDnd;
}
