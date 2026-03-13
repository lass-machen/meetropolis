import { useCallback, useMemo } from 'react';
import { logger } from '../../../lib/logger';
import { EditorService } from '../../../services/EditorService';

interface UseWorldEventHandlersParams {
  apiBase: string;
  avRef: React.RefObject<any>;
  colyseusRef: React.RefObject<any>;
  localPosRef: React.RefObject<{ id: string; x?: number; y?: number }>;
  bubbleGroupsRef: React.RefObject<Record<string, string>>;
  bubbleMembersRef: React.RefObject<Set<string>>;
  bubbleStartRef: React.RefObject<null | ((id: string) => void)>;
  followRef: React.RefObject<any>;
  manualNavRef: React.MutableRefObject<{ x: number; y: number } | null>;
  gameBridge: any;
  editor: any;
  avState: { mic: boolean; cam: boolean; share: boolean; dnd: boolean };
  contextMenu: { open: boolean; x: number; y: number; playerId: string | null };

  setAvState: React.Dispatch<React.SetStateAction<{ mic: boolean; cam: boolean; share: boolean; dnd: boolean }>>;
  setMe: React.Dispatch<React.SetStateAction<{ id: string; email: string; name?: string } | null>>;
  setGridExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedSid: React.Dispatch<React.SetStateAction<string | null>>;
  setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setUserModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setInvitesModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPage: React.Dispatch<React.SetStateAction<'world' | 'admin' | string>>;
  setAdminOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setApiModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setBillingOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setProfileOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTenantSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSessionsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setRosterCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setBubbleUi: React.Dispatch<React.SetStateAction<{ active: boolean; members: string[] }>>;
  setContextMenu: React.Dispatch<React.SetStateAction<{ open: boolean; x: number; y: number; playerId: string | null }>>;
  setSelectedMicId: React.Dispatch<React.SetStateAction<string | ''>>;
  setSelectedCamId: React.Dispatch<React.SetStateAction<string | ''>>;

  applyVolumesToUi: () => void;
  saveAllToServer: () => Promise<boolean>;
  handleConnectionReload: () => void;
  dismissBanner: () => void;
}

export function useWorldEventHandlers(params: UseWorldEventHandlersParams) {
  const {
    apiBase,
    avRef,
    colyseusRef,
    localPosRef,
    bubbleGroupsRef,
    bubbleMembersRef,
    bubbleStartRef,
    followRef,
    manualNavRef,
    gameBridge,
    editor,
    avState,
    contextMenu,
    setAvState,
    setMe,
    setGridExpanded,
    setSelectedSid,
    setMenuOpen,
    setUserModalOpen,
    setInvitesModalOpen,
    setPage,
    setAdminOpen,
    setApiModalOpen,
    setBillingOpen,
    setProfileOpen,
    setTenantSettingsOpen,
    setSessionsOpen,
    setRosterCollapsed,
    setBubbleUi,
    setContextMenu,
    setSelectedMicId,
    setSelectedCamId,
    applyVolumesToUi,
    saveAllToServer,
    handleConnectionReload,
    dismissBanner,
  } = params;

  // AV Event Handlers
  const handleToggleMic = useCallback(async () => {
    const enabled = !avState.mic;
    try {
      const anyRoom: any = avRef.current?.room;
      if (anyRoom?.startAudio) await anyRoom.startAudio().catch(() => {});
      const ctx = anyRoom?.engine?.client?.audioContext || anyRoom?.engine?.audioContext;
      if (ctx?.state === 'suspended') await ctx.resume().catch(() => {});
    } catch {}
    setAvState(s => ({ ...s, mic: enabled }));
    try {
      await avRef.current?.setMicrophoneEnabled(enabled);
    } catch (e) {
      setAvState(s => ({ ...s, mic: !enabled }));
      return;
    }
    try {
      const mod: any = await import('../../../av/core/localState');
      const roomAny: any = avRef.current?.room as any;
      const realOn = mod.isLocalMicOn(roomAny);
      if (realOn !== enabled) {
        setAvState(s => ({ ...s, mic: realOn }));
      }
      setTimeout(() => {
        try {
          const again = mod.isLocalMicOn(avRef.current?.room as any);
          if (again !== realOn) {
            setAvState(s => ({ ...s, mic: again }));
          }
        } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      }, 400);
    } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
  }, [avState.mic, avRef, setAvState]);

  const handleSelectMic = useCallback(async (id: string) => {
    setSelectedMicId(id);
    await avRef.current?.useMicrophoneDevice(id);
  }, [avRef, setSelectedMicId]);

  const handleToggleCam = useCallback(async () => {
    const enabled = !avState.cam;
    setAvState(s => ({ ...s, cam: enabled }));
    try {
      await avRef.current?.setCameraEnabled(enabled);
    } catch (e) {
      setAvState(s => ({ ...s, cam: !enabled }));
    }
  }, [avState.cam, avRef, setAvState]);

  const handleSelectCam = useCallback(async (id: string) => {
    setSelectedCamId(id);
    await avRef.current?.useCameraDevice(id);
  }, [avRef, setSelectedCamId]);

  const handleToggleShare = useCallback(async () => {
    try {
      if (!avState.share) {
        const ok = await avRef.current?.startScreenshare();
        if (ok) setAvState(s => ({ ...s, share: true }));
      } else {
        await avRef.current?.stopScreenshare();
        setAvState(s => ({ ...s, share: false }));
      }
    } catch (e) { logger.warn('[WorldApp] Failed to toggle screenshare', e); }
  }, [avState.share, avRef, setAvState]);

  const handleToggleDnd = useCallback(async () => {
    const current = avState.dnd;
    const next = !current;
    try { (gameBridge as any).setDoNotDisturb?.(next); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    try { (gameBridge as any).setMovementLocked?.(next); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
  }, [avState.dnd, gameBridge]);

  const handleRecenter = useCallback(() => {
    try { gameBridge.recenterCamera(); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
  }, [gameBridge]);

  // UI Event Handlers
  const handleToggleExpand = useCallback(() => setGridExpanded(e => {
    const next = !e;
    localStorage.setItem('uc-container-expanded', String(next));
    return next;
  }), [setGridExpanded]);

  const handleSelectSid = useCallback((sid: string | null) => setSelectedSid(sid), [setSelectedSid]);

  const handleToggleMenu = useCallback(() => setMenuOpen(v => !v), [setMenuOpen]);

  const handleOpenUsers = useCallback(() => {
    setUserModalOpen(true);
    setMenuOpen(false);
  }, [setUserModalOpen, setMenuOpen]);

  const handleOpenInvites = useCallback(() => {
    setInvitesModalOpen(true);
    setMenuOpen(false);
  }, [setInvitesModalOpen, setMenuOpen]);

  const handleBackToWorld = useCallback(() => {
    setPage('world');
    setMenuOpen(false);
  }, [setPage, setMenuOpen]);

  const handleOpenAdmin = useCallback(() => {
    setAdminOpen(true);
    setMenuOpen(false);
  }, [setAdminOpen, setMenuOpen]);

  const handleOpenApi = useCallback(() => {
    setApiModalOpen(true);
    setMenuOpen(false);
  }, [setApiModalOpen, setMenuOpen]);

  const handleOpenBilling = useCallback(() => {
    setBillingOpen(true);
    setMenuOpen(false);
  }, [setBillingOpen, setMenuOpen]);

  const handleOpenProfile = useCallback(() => {
    setProfileOpen(true);
    setMenuOpen(false);
  }, [setProfileOpen, setMenuOpen]);

  const handleOpenTenantSettings = useCallback(() => {
    setTenantSettingsOpen(true);
    setMenuOpen(false);
  }, [setTenantSettingsOpen, setMenuOpen]);

  const handleOpenSessions = useCallback(() => {
    setSessionsOpen(true);
    setMenuOpen(false);
  }, [setSessionsOpen, setMenuOpen]);

  const handleResetApp = useCallback(async () => {
    setMenuOpen(false);
    try { await avRef.current?.leave?.(); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    try {
      const room: any = colyseusRef.current;
      const wsReadyState = room?.connection?.ws?.readyState ?? room?.connection?.transport?.ws?.readyState ?? room?.connection?._transport?.ws?.readyState;
      const isOpen = room?.connection?.isOpen === true || wsReadyState === 1;
      if (isOpen) await room.leave();
    } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    try { await fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'include' }); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    try { localStorage.clear(); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    try { sessionStorage.clear(); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    try {
      const parts = (document.cookie || '').split(';');
      for (const raw of parts) {
        const name = raw.split('=')[0]?.trim();
        if (!name) continue;
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      }
    } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    window.location.reload();
  }, [apiBase, avRef, colyseusRef, setMenuOpen]);

  const handleToggleEditor = useCallback(async () => {
    const isCurrentlyActive = editor.active;
    if (isCurrentlyActive) {
      await saveAllToServer().catch(() => { });
    }
    if (isCurrentlyActive) {
      EditorService.dispatch({ type: 'DEACTIVATE_EDITOR' });
    } else {
      EditorService.dispatch({ type: 'ACTIVATE_EDITOR' });
    }
    setMenuOpen(false);
  }, [editor.active, saveAllToServer, setMenuOpen]);

  const handleLogout = useCallback(async () => {
    try { await fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'include' }); } finally { setMe(null); setMenuOpen(false); setPage('world'); }
  }, [apiBase, setMe, setMenuOpen, setPage]);

  const handleToggleRosterCollapse = useCallback(() => setRosterCollapsed(v => !v), [setRosterCollapsed]);

  const handleJumpTo = useCallback((r: { x?: number; y?: number }) => {
    try {
      if (typeof r.x === 'number' && typeof r.y === 'number') {
        manualNavRef.current = { x: r.x!, y: r.y! };
        gameBridge.setDesiredPosition({ x: r.x!, y: r.y! });
        try { (window as any).currentPhaserScene?.cameras?.main?.pan?.(r.x!, r.y!, 250, 'Sine.easeInOut'); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      }
    } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
  }, [gameBridge, manualNavRef]);

  const handleBubbleLeave = useCallback(() => {
    const set = bubbleMembersRef.current;
    set?.clear();
    try { gameBridge.setBubbleMembers(new Set()); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    try { gameBridge.setMovementLocked(false); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    try {
      const meId = localPosRef.current?.id;
      const groups = bubbleGroupsRef.current ?? {};
      const myGroup = meId ? (groups[meId] || null) : null;
      if (meId && myGroup) {
        const currentMembers = Object.entries(groups)
          .filter(([, _gid]) => _gid === myGroup)
          .map(([sid]) => sid);
        const remaining = currentMembers.filter((sid) => sid !== meId);
        colyseusRef.current?.send?.('bubble_update', { id: myGroup, members: remaining });
      }
    } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    setBubbleUi({ active: false, members: [] });
    setTimeout(() => applyVolumesToUi(), 0);
  }, [applyVolumesToUi, bubbleGroupsRef, bubbleMembersRef, colyseusRef, gameBridge, localPosRef, setBubbleUi]);

  const handleConnectionReloadClick = useCallback(() => {
    handleConnectionReload();
  }, [handleConnectionReload]);

  const handleDismissBanner = useCallback(() => {
    dismissBanner();
  }, [dismissBanner]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu({ open: false, x: 0, y: 0, playerId: null });
  }, [setContextMenu]);

  const handleContextMenuFollow = useCallback(() => {
    setContextMenu({ open: false, x: 0, y: 0, playerId: null });
    const id = contextMenu.playerId!;
    if (followRef.current?.getTarget?.() === id) {
      followRef.current.stop();
      gameBridge.setDesiredPosition(null);
    } else {
      followRef.current?.startFollowing?.(id);
    }
  }, [contextMenu.playerId, followRef, gameBridge, setContextMenu]);

  const handleContextMenuJoinBubble = useCallback(() => {
    setContextMenu({ open: false, x: 0, y: 0, playerId: null });
    try {
      const target = contextMenu.playerId!;
      const groups = bubbleGroupsRef.current ?? {};
      const targetGroup = groups[target];
      const meId = localPosRef.current?.id;
      if (!target || !targetGroup || !meId) return;
      const currentMembers = Object.entries(groups)
        .filter(([, _gid]) => _gid === targetGroup)
        .map(([sid]) => sid);
      const next = Array.from(new Set([...currentMembers, meId]));
      colyseusRef.current?.send?.('bubble_update', { id: targetGroup, members: next });
    } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
  }, [contextMenu.playerId, bubbleGroupsRef, colyseusRef, localPosRef, setContextMenu]);

  const handleContextMenuAddToBubble = useCallback(() => {
    setContextMenu({ open: false, x: 0, y: 0, playerId: null });
    try {
      const id = contextMenu.playerId!;
      const meId = localPosRef.current?.id;
      if (!meId || !id || meId === id) return;
      const groups = bubbleGroupsRef.current ?? {};
      const myGroup = groups[meId];
      if (!myGroup) return;
      const currentMembers = Object.entries(groups)
        .filter(([, _gid]) => _gid === myGroup)
        .map(([sid]) => sid);
      const next = Array.from(new Set([...currentMembers, id]));
      colyseusRef.current?.send?.('bubble_update', { id: myGroup, members: next });
    } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
  }, [contextMenu.playerId, bubbleGroupsRef, colyseusRef, localPosRef, setContextMenu]);

  const handleContextMenuStartBubble = useCallback(() => {
    setContextMenu({ open: false, x: 0, y: 0, playerId: null });
    const id = contextMenu.playerId!;
    bubbleStartRef.current?.(id);
  }, [contextMenu.playerId, bubbleStartRef, setContextMenu]);

  // Computed values
  const showJoinBubbleOption = useMemo(() => {
    try {
      const target = contextMenu.playerId;
      if (!target) return false;
      const targetGroup = bubbleGroupsRef.current?.[target];
      const meId = localPosRef.current?.id;
      const myGroup = meId ? (bubbleGroupsRef.current?.[meId] || null) : null;
      return !!targetGroup && targetGroup !== myGroup;
    } catch {
      return false;
    }
  }, [contextMenu.playerId, bubbleGroupsRef, localPosRef]);

  const showAddToBubbleOption = useMemo(() => {
    try {
      const meId = localPosRef.current?.id;
      const myGroup = meId ? (bubbleGroupsRef.current?.[meId] || null) : null;
      return !!myGroup;
    } catch {
      return false;
    }
  }, [bubbleGroupsRef, localPosRef]);

  return {
    // AV Handlers
    handleToggleMic,
    handleSelectMic,
    handleToggleCam,
    handleSelectCam,
    handleToggleShare,
    handleToggleDnd,
    handleRecenter,

    // UI Handlers
    handleToggleExpand,
    handleSelectSid,
    handleToggleMenu,
    handleOpenUsers,
    handleOpenInvites,
    handleBackToWorld,
    handleOpenAdmin,
    handleOpenApi,
    handleOpenBilling,
    handleOpenProfile,
    handleOpenTenantSettings,
    handleOpenSessions,
    handleResetApp,
    handleToggleEditor,
    handleLogout,
    handleToggleRosterCollapse,
    handleJumpTo,
    handleBubbleLeave,
    handleConnectionReloadClick,
    handleDismissBanner,

    // Context Menu Handlers
    handleCloseContextMenu,
    handleContextMenuFollow,
    handleContextMenuJoinBubble,
    handleContextMenuAddToBubble,
    handleContextMenuStartBubble,
    showJoinBubbleOption,
    showAddToBubbleOption,
  };
}
