import { useEffect } from 'react';
import { createPhaserGame, destroyPhaserGame } from '../../../game/phaserGame';
import { gameBridge } from '../../../game/bridge';
import { logger } from '../../../lib/logger';
import { BubbleManager } from '../../../game/bubbleManager';
import { FollowManager } from '../../../game/followManager';
import { ZoneManager } from '../../../game/zoneManager';
import { VolumeManager } from '../../../game/volumeManager';
import { pointInPolygon } from '../../../lib/geom';
import { avatarRegistry } from '../../../game/avatarRegistry';
import { useMapStore } from '../../../state/mapStore';

interface UseGameInitializationParams {
  authChecked: boolean;
  me: { id: string; email: string; name?: string } | null;
  apiBase: string;
  containerRef: React.RefObject<HTMLDivElement>;
  bubbleRef: React.MutableRefObject<BubbleManager | null>;
  followRef: React.MutableRefObject<FollowManager | null>;
  zoneRef: React.MutableRefObject<ZoneManager | null>;
  volumeRef: React.MutableRefObject<VolumeManager | null>;
  gameCreatedRef: React.MutableRefObject<boolean>;
  editorActiveRef: React.RefObject<boolean>;
  localPosRef: React.MutableRefObject<{ id: string; x?: number; y?: number }>;
  remotesRef: React.MutableRefObject<Record<string, { x: number; y: number }>>;
  bubblePendingRef: React.MutableRefObject<{ targetId: string; dest?: { x: number; y: number } } | null>;
  activateBubbleNowRef: React.RefObject<(id: string) => void>;
  manualNavRef: React.MutableRefObject<{ x: number; y: number } | null>;
  lastSavedPositionRef: React.MutableRefObject<{ x: number; y: number; direction: string }>;
  moveTimeoutRef: React.MutableRefObject<any>;
  colyseusRef: React.RefObject<any>;
  avRef: React.RefObject<any>;
  colyseusToLivekitMap: React.RefObject<Record<string, string>>;
  colyseusReconnectTimerRef: React.MutableRefObject<any>;
  bubbleGroupsRef: React.RefObject<Record<string, string>>;
  editor: any;
  setEditor: (editor: any) => void;
  setContextMenu: React.Dispatch<
    React.SetStateAction<{ open: boolean; x: number; y: number; playerId: string | null }>
  >;
  buildParticipantList: () => void;
  applyVolumesToUi: () => void;
}

function clearContainer(containerRef: React.RefObject<HTMLDivElement>) {
  try {
    const el = containerRef.current;
    while (el && el.firstChild) {
      el.removeChild(el.firstChild);
    }
  } catch (e) {
    logger.debug('[WorldApp] Operation failed', e);
  }
}

function buildSavePosition(params: UseGameInitializationParams) {
  const { localPosRef, lastSavedPositionRef, apiBase } = params;
  return async (opts?: { immediate?: boolean }) => {
    const currentPos = localPosRef.current;
    const currentDirection = (gameBridge as any).lastDirection || 'down';
    const last = lastSavedPositionRef.current;
    const hasMoved =
      typeof currentPos.x === 'number' &&
      typeof currentPos.y === 'number' &&
      (Math.abs(currentPos.x - last.x) > 10 ||
        Math.abs(currentPos.y - last.y) > 10 ||
        currentDirection !== last.direction);
    if (!hasMoved && !opts?.immediate) return;
    lastSavedPositionRef.current = {
      x: currentPos.x || last.x,
      y: currentPos.y || last.y,
      direction: currentDirection,
    };
    const currentMapName = useMapStore.getState().currentMapName;
    const payload = JSON.stringify({
      x: Math.round(lastSavedPositionRef.current.x),
      y: Math.round(lastSavedPositionRef.current.y),
      direction: lastSavedPositionRef.current.direction,
      mapName: currentMapName,
    });
    try {
      if (opts?.immediate) {
        fetch(`${apiBase}/auth/position`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          body: payload,
        }).catch(() => {});
      } else {
        await fetch(`${apiBase}/auth/position`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
      }
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
  };
}

function checkBubbleArrival(p: { x: number; y: number }, params: UseGameInitializationParams) {
  const { bubblePendingRef, remotesRef, followRef, activateBubbleNowRef } = params;
  try {
    const pending = bubblePendingRef.current;
    if (!pending) return;
    let arrived = false;
    if (pending.dest) {
      const dx = (p.x || 0) - pending.dest.x;
      const dy = (p.y || 0) - pending.dest.y;
      arrived = dx * dx + dy * dy < 12 * 12;
    }
    if (!arrived) {
      const t = remotesRef.current[pending.targetId];
      if (t) {
        const dx = (p.x || 0) - t.x;
        const dy = (p.y || 0) - t.y;
        arrived = dx * dx + dy * dy < 20 * 20;
      }
    }
    if (arrived) {
      try {
        followRef.current?.stop?.();
      } catch (e) {
        logger.debug('[WorldApp] Operation failed', e);
      }
      try {
        gameBridge.setDesiredPosition(null);
      } catch (e) {
        logger.debug('[WorldApp] Operation failed', e);
      }
      try {
        activateBubbleNowRef.current?.(pending.targetId);
      } catch (e) {
        logger.debug('[WorldApp] Operation failed', e);
      }
      bubblePendingRef.current = null;
    }
  } catch (e) {
    logger.debug('[WorldApp] Operation failed', e);
  }
}

function applyFollowOrManualNav(p: { x: number; y: number }, params: UseGameInitializationParams) {
  const { followRef, remotesRef, bubblePendingRef, manualNavRef } = params;
  if (!followRef.current) return;
  const f = followRef.current.update({ x: p.x, y: p.y }, remotesRef.current);
  if (!bubblePendingRef.current) {
    if (f.following) {
      gameBridge.setDesiredPosition({ x: f.x, y: f.y });
    } else {
      const target = manualNavRef.current;
      if (target) {
        const dx = (target.x ?? 0) - p.x;
        const dy = (target.y ?? 0) - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= 12) {
          manualNavRef.current = null;
          gameBridge.setDesiredPosition(null);
        } else gameBridge.setDesiredPosition({ x: target.x, y: target.y });
      } else {
        gameBridge.setDesiredPosition(null);
      }
    }
  } else if (f.following) {
    gameBridge.setDesiredPosition({ x: f.x, y: f.y });
  }
}

function sendMoveToServer(p: { x: number; y: number; direction: string }, colyseusRef: React.RefObject<any>) {
  try {
    const room: any = colyseusRef.current;
    const wsReadyState =
      room?.connection?.ws?.readyState ??
      room?.connection?.transport?.ws?.readyState ??
      room?.connection?._transport?.ws?.readyState;
    const isOpen = room?.connection?.isOpen === true || wsReadyState === 1;
    if (room && isOpen) {
      room.send('move', p);
    }
  } catch (_e) {
    /* noop */
  }
}

function buildLocalMoveHandler(
  params: UseGameInitializationParams,
  savePosition: (opts?: { immediate?: boolean }) => Promise<void>,
) {
  const { localPosRef, zoneRef, buildParticipantList, applyVolumesToUi, colyseusRef, moveTimeoutRef } = params;
  let lastZone: string | null = null;
  return (p: { x: number; y: number; direction: string }) => {
    localPosRef.current.x = p.x;
    localPosRef.current.y = p.y;
    (gameBridge as any).lastDirection = p.direction;
    zoneRef.current?.update({ x: p.x, y: p.y });
    checkBubbleArrival(p, params);
    const zones = zoneRef.current?.getZones?.() || [];
    const currentZone = zones.find((z) => pointInPolygon({ x: p.x, y: p.y }, z.points));
    const currentZoneName = currentZone?.name || null;
    if (currentZoneName !== lastZone) {
      lastZone = currentZoneName;
      setTimeout(buildParticipantList, 50);
      applyVolumesToUi();
    }
    applyFollowOrManualNav(p, params);
    sendMoveToServer(p, colyseusRef);
    if (moveTimeoutRef.current) {
      clearTimeout(moveTimeoutRef.current);
    }
    moveTimeoutRef.current = setTimeout(() => {
      void savePosition();
      moveTimeoutRef.current = null;
    }, 1000);
  };
}

function createVolumeManager(params: UseGameInitializationParams) {
  const { colyseusToLivekitMap, avRef, localPosRef, remotesRef, zoneRef, followRef, bubbleGroupsRef } = params;
  return new VolumeManager(
    {
      setParticipantVolume: (colyseusId, vol) => {
        const livekitIdentity = colyseusToLivekitMap.current?.[colyseusId];
        if (livekitIdentity && avRef.current) avRef.current.setParticipantVolume(livekitIdentity, vol);
      },
    },
    {
      getLocal: () => {
        const pos = localPosRef.current;
        if (pos.id && typeof pos.x === 'number' && typeof pos.y === 'number') return { id: pos.id, x: pos.x, y: pos.y };
        return null;
      },
      getRemotes: () => remotesRef.current,
      getZones: () => zoneRef.current?.getZones?.() || [],
      getFollowTarget: () => followRef.current?.getTarget?.() || null,
      getBubbleGroups: () => bubbleGroupsRef.current ?? {},
      getLocalDnd: () => !!avRef.current?.dndEnabled,
    },
    { nearRadius: 96, farRadius: 384, outsideBubbleAttenuation: 0.05 },
  );
}

function bindGameBridgeHandlers(params: UseGameInitializationParams) {
  const { editorActiveRef, setEditor, setContextMenu } = params;
  gameBridge.onPointerDown = ({ x, y }) => {
    if (editorActiveRef.current) return;
    setEditor((prev: any) => {
      if (!prev.active) return prev;
      if (prev.tool === 'erase' && prev.category === 'objects') {
        const clickRadius = 16;
        const clickedAsset = prev.assets.find(
          (a: any) => Math.abs(a.x - x) < clickRadius && Math.abs(a.y - y) < clickRadius,
        );
        if (clickedAsset) {
          const assets = prev.assets.filter((a: any) => a.id !== clickedAsset.id);
          return { ...prev, assets };
        }
        return prev;
      }
      return prev;
    });
  };
  gameBridge.onRightClick = ({ x, y, playerId }) => {
    if (editorActiveRef.current) return;
    if (!playerId) return;
    try {
      logger.debug('[UI] context menu for', playerId, 'at', x, y);
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
    setContextMenu({ open: true, x, y, playerId });
  };
}

async function initPhaserGame(params: UseGameInitializationParams) {
  const { apiBase, containerRef, volumeRef, me } = params;
  await avatarRegistry.loadPacks(apiBase);
  if (!containerRef.current) return null;
  const game = createPhaserGame(containerRef.current);
  volumeRef.current = createVolumeManager(params);
  setTimeout(() => {
    try {
      gameBridge.reloadEditorLayers();
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
    const heroName = me!.name || me!.email || 'You';
    setTimeout(() => {
      try {
        gameBridge.setHeroName(heroName);
      } catch (e) {
        logger.debug('[WorldApp] Operation failed', e);
      }
    }, 100);
  }, 0);
  bindGameBridgeHandlers(params);
  return game;
}

function buildCleanup(
  params: UseGameInitializationParams,
  game: ReturnType<typeof createPhaserGame> | null,
  handleBeforeUnload: () => void,
) {
  const { containerRef, colyseusRef, avRef, colyseusReconnectTimerRef, moveTimeoutRef } = params;
  return () => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
    try {
      gameBridge.setSceneApi?.(null);
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
    if (game) destroyPhaserGame(game);
    clearContainer(containerRef);
    try {
      const room: any = colyseusRef.current;
      const wsReadyState =
        room?.connection?.ws?.readyState ??
        room?.connection?.transport?.ws?.readyState ??
        room?.connection?._transport?.ws?.readyState;
      const isOpen = room?.connection?.isOpen === true || wsReadyState === 1;
      if (isOpen) room.leave();
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
    try {
      avRef.current?.leave?.();
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
    try {
      if (colyseusReconnectTimerRef.current) clearTimeout(colyseusReconnectTimerRef.current);
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
    if (moveTimeoutRef.current) {
      clearTimeout(moveTimeoutRef.current);
    }
  };
}

export function useGameInitialization(params: UseGameInitializationParams) {
  const { authChecked, me, apiBase, containerRef, bubbleRef, followRef, zoneRef, gameCreatedRef, editor } = params;

  useEffect(() => {
    if (!authChecked || !me) return;
    if (!containerRef.current) return;
    if (gameCreatedRef.current) return;
    gameCreatedRef.current = true;
    clearContainer(containerRef);

    bubbleRef.current = new BubbleManager(64, null);
    followRef.current = new FollowManager(96);
    zoneRef.current = new ZoneManager([], null);
    try {
      zoneRef.current.setZones(editor.zones);
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }

    const savePosition = buildSavePosition(params);
    const handleBeforeUnload = () => {
      void savePosition({ immediate: true });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    gameBridge.onLocalMove = buildLocalMoveHandler(params, savePosition);

    let game: ReturnType<typeof createPhaserGame> | null = null;
    void initPhaserGame(params).then((g) => {
      game = g;
    });

    return buildCleanup(params, game, handleBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, me?.id, apiBase]);
}
