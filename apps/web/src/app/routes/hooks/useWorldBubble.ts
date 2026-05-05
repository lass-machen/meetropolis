import { useBubbleNavigation } from '../../../features/bubble/useBubbleNavigation';
import { gameBridge } from '../../../game/bridge';
import { logger } from '../../../lib/logger';

/**
 * Wires bubble navigation refs (`activateBubbleNowRef`, `bubbleStartRef`) into
 * the world refs and returns the navigator handles for downstream use.
 */
export function useWorldBubble(refs: any, ui: any, applyVolumesToUi: () => void) {
  const { startBubbleTo, activateBubbleNow } = useBubbleNavigation({
    bubbleMembersRef: refs.bubbleMembersRef, localPosRef: refs.localPosRef, colyseusRef: refs.colyseusRef,
    gameBridge, identityToNameMap: refs.identityToNameMap, colyseusToLivekitMap: refs.colyseusToLivekitMap,
    setBubbleUi: ui.setBubbleUi, applyVolumesToUi, followRef: refs.followRef,
  });
  refs.activateBubbleNowRef.current = activateBubbleNow;
  refs.bubbleStartRef.current = (id: string) => {
    try {
      let dest: { x: number; y: number } | undefined = undefined;
      try {
        const free = gameBridge.findFreeSpotNear(id, { radius: 16, step: 16 });
        if (free) dest = { x: free.x, y: free.y };
      } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      refs.bubblePendingRef.current = dest ? { targetId: id, dest } : { targetId: id };
    } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    try { startBubbleTo(id); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
  };
  return { startBubbleTo, activateBubbleNow };
}
