import React, { useCallback } from 'react';
import { gameBridge } from '../../../game/bridge';
import { useAvSettingsStore } from '../../../state/avSettings';
import { useWorldEventHandlers } from './useWorldEventHandlers';

/**
 * Bundles `useWorldEventHandlers` with the PTT-aware mic toggle so the WorldApp
 * top-level can simply consume one return value.
 */
export function useWorldEventBundle(params: {
  apiBase: string;
  refs: any;
  ui: any;
  auth: any;
  editor: any;
  applyVolumesToUi: () => void;
  saveAllToServer: () => Promise<boolean>;
  handleConnectionReload: () => void;
  dismissBanner: () => void;
}) {
  const { apiBase, refs, ui, auth, editor, applyVolumesToUi, saveAllToServer, handleConnectionReload, dismissBanner } = params;

  const eventHandlers = useWorldEventHandlers({
    apiBase, avRef: refs.avRef, colyseusRef: refs.colyseusRef, localPosRef: refs.localPosRef,
    bubbleGroupsRef: refs.bubbleGroupsRef, bubbleMembersRef: refs.bubbleMembersRef,
    bubbleStartRef: refs.bubbleStartRef, followRef: refs.followRef, manualNavRef: refs.manualNavRef,
    gameBridge, editor, avState: ui.avState, contextMenu: ui.contextMenu,
    setAvState: ui.setAvState, setMe: auth.setMe, setGridExpanded: ui.setGridExpanded,
    setSelectedSid: ui.setSelectedSid, setMenuOpen: ui.setMenuOpen, setTenantTab: ui.setTenantTab,
    setPage: ui.setPage, setAdminOpen: ui.setAdminOpen, setApiModalOpen: ui.setApiModalOpen,
    setBillingOpen: ui.setBillingOpen, setProfileOpen: ui.setProfileOpen,
    setTenantSettingsOpen: ui.setTenantSettingsOpen, setSessionsOpen: ui.setSessionsOpen,
    setRosterCollapsed: ui.setRosterCollapsed, setBubbleUi: ui.setBubbleUi, setContextMenu: ui.setContextMenu,
    setSelectedMicId: ui.setSelectedMicId, setSelectedCamId: ui.setSelectedCamId,
    applyVolumesToUi, saveAllToServer, handleConnectionReload, dismissBanner,
  });

  const pttAwareToggleMic = useCallback(async () => {
    const pttOn = useAvSettingsStore.getState().settings.pushToTalk;
    if (pttOn) {
      useAvSettingsStore.getState().setSetting('pushToTalk', false);
      return;
    }
    await eventHandlers.handleToggleMic();
  }, [eventHandlers.handleToggleMic]);

  return { eventHandlers, pttAwareToggleMic };
}
