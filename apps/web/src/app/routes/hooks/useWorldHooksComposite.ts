import React from 'react';
import { useApiTokensLoader } from '../../../features/admin/useApiTokens';
import { useDoNotDisturb } from '../../../av/hooks/useDoNotDisturb';
import { useRosterPresence } from '../../../features/roster/useRosterPresence';
import { useAVManager } from '../../../av/hooks/useAVManager';
import { useScreenshareEvents } from '../../../av/hooks/useScreenshareEvents';
import { useGlobalAudioTracks } from '../../../av/useGlobalAudioTracks';
import { useZones as useZonesSync } from '../../../features/zones/useZones';
import { useHudTicker } from '../../../features/hud/useHudTicker';
import { useWorldRoom } from '../../../realtime/useWorldRoom';
import { useFetchMe } from './useFetchMe';
import { useEditorLoader } from './useEditorLoader';
import { useGameInitialization } from './useGameInitialization';
import { useAvStateSync } from './useAvStateSync';
import { useMapZonesSync } from './useMapZonesSync';
import { useConnectionRecovery } from '../../../hooks/useConnectionRecovery';
import { logger } from '../../../lib/logger';
import { onAudioTracksChanged } from '../../../lib/avEvents';
import { gameBridge } from '../../../game/bridge';

/**
 * Convenience composite that wires the long list of "side-effect" hooks for
 * WorldApp.tsx so that the top-level component only orchestrates them.
 *
 * The hook order is preserved exactly as in the original WorldApp body to keep
 * React's rules-of-hooks contract intact.
 */
export function useWorldRealtimeHooks(params: {
  apiBase: string;
  authChecked: boolean;
  me: any;
  refs: any;
  ui: any;
  editor: any;
  setEditor: any;
  buildParticipantList: () => void;
  applyVolumesToUi: () => void;
}) {
  const { apiBase, authChecked, me, refs, ui, editor, setEditor, buildParticipantList, applyVolumesToUi } = params;

  useApiTokensLoader({ apiBase, open: ui.apiModalOpen, setFreshToken: ui.setFreshToken, setApiTokens: ui.setApiTokens });
  useDoNotDisturb({ enabled: !!(authChecked && me), avRef: refs.avRef, dndRef: refs.dndRef, setAvState: ui.setAvState, colyseusRef: refs.colyseusRef });
  useRosterPresence({ apiBase, authChecked, meId: me?.id ?? null, rosterByIdentityRef: refs.rosterByIdentityRef, setRoster: ui.setRoster, avRef: refs.avRef });
  useAVManager({ apiBase, me, editorActiveRef: refs.editorActiveRef, avRef: refs.avRef, setDevices: ui.setDevices, setSelectedMicId: ui.setSelectedMicId, setSelectedCamId: ui.setSelectedCamId, buildParticipantList });

  useScreenshareEvents({
    avRef: refs.avRef,
    enabled: !!(authChecked && me && !editor.active && !ui.avState.dnd),
    onRemoteScreenshareStart: React.useCallback((participantSid: string) => {
      const now = Date.now();
      if (ui.selectedSid) return;
      if (now - refs.lastAutoFullscreenRef.current < 5000) return;
      refs.lastAutoFullscreenRef.current = now;
      const screenSid = participantSid + ':screen';
      ui.setSelectedSid(screenSid);
      ui.setOverlayZoom(1);
      setTimeout(() => buildParticipantList(), 200);
    }, [ui.selectedSid, buildParticipantList, refs.lastAutoFullscreenRef, ui.setSelectedSid, ui.setOverlayZoom]),
    onRemoteScreenshareStop: React.useCallback((participantSid: string) => {
      const screenSid = participantSid + ':screen';
      if (ui.selectedSid === screenSid) { ui.setSelectedSid(null); ui.setOverlayZoom(1); }
    }, [ui.selectedSid, ui.setSelectedSid, ui.setOverlayZoom]),
  });

  const recovery = useConnectionRecovery({
    enabled: !!(authChecked && me), colyseusRef: refs.colyseusRef,
    onConnectionLost: () => logger.warn('[WorldApp] Colyseus connection lost'),
    onConnectionRestored: () => { logger.debug('[WorldApp] Colyseus connection restored'); setTimeout(() => buildParticipantList(), 500); },
  });

  useWorldRoom({
    apiBase, me, avRef: refs.avRef, colyseusRef: refs.colyseusRef, localPosRef: refs.localPosRef,
    remotesRef: refs.remotesRef, colyseusToLivekitMap: refs.colyseusToLivekitMap,
    identityToNameMap: refs.identityToNameMap, gameBridge, editor, setEditor, zoneRef: refs.zoneRef,
    buildParticipantList, applyVolumesToUi, setBubbleUi: ui.setBubbleUi,
    bubbleMembersRef: refs.bubbleMembersRef, bubbleGroupsRef: refs.bubbleGroupsRef, dndRef: refs.dndRef,
    setAvState: ui.setAvState, rosterByIdentityRef: refs.rosterByIdentityRef, setRoster: ui.setRoster,
    disposedRef: refs.disposedRef, setConnectionStatus: ui.setConnStatus,
  });

  return recovery;
}

export function useWorldDataHooks(params: {
  apiBase: string;
  me: any;
  refs: any;
  ui: any;
  editor: any;
  setEditor: any;
  authRefetchTrigger: number;
  setAuth: any;
  buildParticipantList: () => void;
  applyVolumesToUi: () => void;
}) {
  const { apiBase, me, refs, ui, editor, setEditor, authRefetchTrigger, setAuth, buildParticipantList, applyVolumesToUi } = params;

  useFetchMe({ apiBase, localPosRef: refs.localPosRef, setMe: setAuth.setMe, setIsInternalOwner: setAuth.setIsInternalOwner, setCapabilities: setAuth.setCapabilities, setPositionReady: setAuth.setPositionReady, setAuthChecked: setAuth.setAuthChecked, refetchTrigger: authRefetchTrigger });

  useMapZonesSync({ me, apiBase, zoneRef: refs.zoneRef, setEditor });
  useEditorLoader({ me, apiBase, setEditor });

  React.useEffect(() => { setEditor((s: any) => ({ ...s, pendingAsset: null, tool: 'select' })); }, [editor.category, setEditor]);

  useGameInitialization({
    authChecked: setAuth.authChecked, me, apiBase, containerRef: refs.containerRef,
    bubbleRef: refs.bubbleRef, followRef: refs.followRef, zoneRef: refs.zoneRef, volumeRef: refs.volumeRef,
    gameCreatedRef: refs.gameCreatedRef, editorActiveRef: refs.editorActiveRef, localPosRef: refs.localPosRef,
    remotesRef: refs.remotesRef, bubblePendingRef: refs.bubblePendingRef,
    activateBubbleNowRef: refs.activateBubbleNowRef, manualNavRef: refs.manualNavRef,
    lastSavedPositionRef: refs.lastSavedPositionRef, moveTimeoutRef: refs.moveTimeoutRef,
    colyseusRef: refs.colyseusRef, avRef: refs.avRef,
    colyseusToLivekitMap: refs.colyseusToLivekitMap, colyseusReconnectTimerRef: refs.colyseusReconnectTimerRef,
    bubbleGroupsRef: refs.bubbleGroupsRef, editor, setEditor, setContextMenu: ui.setContextMenu,
    buildParticipantList, applyVolumesToUi,
  });

  useGlobalAudioTracks({ avRef: refs.avRef });
  React.useEffect(() => {
    let off: (() => void) | null = null;
    try { off = onAudioTracksChanged?.(() => { try { applyVolumesToUi(); } catch (e) { logger.debug('[WorldApp] Operation failed', e); } }) || null; } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    return () => { try { off?.(); } catch (e) { logger.debug('[WorldApp] Operation failed', e); } };
  }, [applyVolumesToUi]);

  useZonesSync({ editor, setEditor, zoneRef: refs.zoneRef, gameBridge, colyseusRef: refs.colyseusRef });
  useAvStateSync(refs.avRef, ui.setAvState);
}

export function useHudTickerWithBubble(params: {
  authChecked: boolean;
  me: any;
  refs: any;
  setHud: any;
  buildParticipantList: () => void;
  activateBubbleNow: (id: string) => void;
}) {
  const { authChecked, me, refs, setHud, buildParticipantList, activateBubbleNow } = params;
  useHudTicker({
    enabled: !!(authChecked && me), zoneRef: refs.zoneRef, avRef: refs.avRef, setHud,
    bubblePendingRef: refs.bubblePendingRef, localPosRef: refs.localPosRef, remotesRef: refs.remotesRef,
    onZoneParticipantRefresh: () => setTimeout(buildParticipantList, 0), volumeRef: refs.volumeRef,
    setParticipantVolumesRef: (vols) => { refs.participantVolumesRef.current = vols; },
    onArrivedAtBubbleTarget: (targetId) => {
      try { refs.followRef.current?.stop?.(); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      try { gameBridge.setDesiredPosition(null); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      try { activateBubbleNow(targetId); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    },
  });
}
