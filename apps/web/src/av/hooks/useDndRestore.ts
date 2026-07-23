/**
 * Re-applies a persisted Do-Not-Disturb state after a page reload.
 *
 * Restoring the flag alone would leave a UI that claims DND while audio keeps
 * flowing, so the restore goes through the same `gameBridge.setDoNotDisturb`
 * funnel a user toggle uses and therefore applies every side effect (mic/cam
 * off, remote audio muted, movement lock, ducking).
 *
 * The funnel's AV step is optional-chained, so running it before the AVManager
 * exists would silently skip exactly those side effects. Hence the restore is
 * driven by the AVManager's `onConnected` callback rather than a timer, with an
 * immediate attempt for the case where a manager is already present (remount).
 */

import React from 'react';
import type { AVManager } from '../avManager';
import { gameBridge } from '../../game/bridge';
import { logger } from '../../lib/logger';
import { readPersistedDnd } from '../features/dndPersistence';

/**
 * Returns a stable callback that performs the restore once. Wire it into
 * `useAVManager({ onConnected })`; it is safe to call more than once.
 *
 * There is deliberately no `enabled`/auth gate: the AVManager only exists once
 * the user is authenticated, so `avRef.current` already implies it, and the
 * persisted value is the real gate. Keeping the callback free of changing
 * dependencies also keeps its identity stable — `useAVManager` captures it in a
 * one-shot timeout, where a later identity change would never be picked up.
 */
export function useDndRestore(avRef: React.MutableRefObject<AVManager | null>): () => void {
  const restoredRef = React.useRef(false);

  const restore = React.useCallback((): void => {
    if (restoredRef.current) return;
    if (!avRef.current) return;
    // Re-read instead of trusting a value captured at mount: the user may have
    // switched DND off while we were still waiting for the AVManager, and that
    // explicit opt-out must win over the restore.
    if (!readPersistedDnd()) {
      restoredRef.current = true;
      return;
    }

    restoredRef.current = true;
    logger.debug('[DND] Restoring persisted DND after reload');
    try {
      gameBridge.setDoNotDisturb?.(true);
      gameBridge.setMovementLocked?.(true, 'dnd');
    } catch {}
  }, [avRef]);

  // Covers a mount where the AVManager already exists; the normal path is the
  // onConnected callback.
  React.useEffect(() => {
    restore();
  }, [restore]);

  return restore;
}
