import React from 'react';
import { logger } from '../../lib/logger';
import type { WorldRoom } from '../../types/colyseus';

type AnyRef<T> = React.MutableRefObject<T>;

interface UseBubbleNavigationParams {
  bubbleMembersRef: AnyRef<Set<string>>;
  localPosRef: AnyRef<{ id: string; x?: number; y?: number }>;
  colyseusRef: AnyRef<WorldRoom | null>;
  gameBridge: any;
  identityToNameMap: AnyRef<Record<string, string>>;
  colyseusToLivekitMap: AnyRef<Record<string, string>>;
  setBubbleUi: React.Dispatch<React.SetStateAction<{ active: boolean; members: string[] }>>;
  applyVolumesToUi: () => void;
  followRef: AnyRef<{ startFollowing?: (id: string) => void; stop?: () => void } | null>;
}

export function useBubbleNavigation(params: UseBubbleNavigationParams) {
  const {
    bubbleMembersRef,
    localPosRef,
    colyseusRef,
    gameBridge,
    identityToNameMap,
    colyseusToLivekitMap,
    setBubbleUi,
    applyVolumesToUi,
    followRef,
  } = params;

  const activateBubbleNow = React.useCallback(
    (targetId: string) => {
      try {
        bubbleMembersRef.current.clear();
        if (localPosRef.current.id) bubbleMembersRef.current.add(localPosRef.current.id);
        bubbleMembersRef.current.add(targetId);
        try {
          gameBridge.setMovementLocked(true);
        } catch {}
        const visual = new Set<string>();
        if (localPosRef.current.id) visual.add('__local__');
        visual.add(targetId);
        try {
          gameBridge.setBubbleMembers(visual);
        } catch {}
        try {
          colyseusRef.current?.send?.('bubble_update', { members: Array.from(bubbleMembersRef.current) });
        } catch {}
        const names: string[] = [];
        const identity = colyseusToLivekitMap.current[targetId] || targetId;
        const name = identityToNameMap.current[identity] || identity;
        names.push(name);
        setBubbleUi({ active: true, members: names });
        applyVolumesToUi();
      } catch {}
    },
    [
      applyVolumesToUi,
      bubbleMembersRef,
      colyseusRef,
      colyseusToLivekitMap,
      gameBridge,
      identityToNameMap,
      localPosRef,
      setBubbleUi,
    ],
  );

  const startBubbleTo = React.useCallback(
    (targetColyseusId: string) => {
      try {
        logger.debug('[Bubble] startBubbleTo', targetColyseusId);
      } catch {}
      try {
        gameBridge.setMovementLocked(false);
      } catch {}
      try {
        followRef.current?.startFollowing?.(targetColyseusId);
      } catch {}
      try {
        const free = gameBridge.findFreeSpotNear(targetColyseusId, { radius: 16, step: 16 });
        if (free) {
          gameBridge.setDesiredPosition({ x: free.x, y: free.y });
        }
      } catch {}
    },
    [followRef, gameBridge],
  );

  return { activateBubbleNow, startBubbleTo };
}
