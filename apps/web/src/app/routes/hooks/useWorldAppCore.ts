import React, { useCallback } from 'react';
import { useEditor } from '../../../hooks/useEditor';
import { useParticipants } from '../../../features/participants/useParticipants';
import { usePaymentStatus } from '../../../ui/billing/hooks/usePaymentStatus';
import { useDesktop } from './useDesktop';
import { gameBridge } from '../../../game/bridge';
import { useWorldRealtimeHooks, useWorldDataHooks, useHudTickerWithBubble } from './useWorldHooksComposite';
import { useWorldBubble } from './useWorldBubble';
import { useWorldEventBundle } from './useWorldEventBundle';
import { useWorldUiHelpers, useParticipantListEffects } from './useWorldUiHelpers';
import { useDesktopShortcuts, useMicShortcut } from './useDesktopShortcuts';
import { useAvSettingsStore } from '../../../state/avSettings';
import { usePushToTalk } from '../../../av/hooks/usePushToTalk';

function useWorldEditorActiveSync(refs: any, editorActive: boolean) {
  React.useEffect(() => { refs.editorActiveRef.current = editorActive; }, [editorActive, refs.editorActiveRef]);
  React.useEffect(() => { gameBridge.setCollisionVisible(!!editorActive); }, [editorActive]);
}

function useWorldParticipantsAndRealtime(params: { refs: any; auth: any; ui: any; apiBase: string; editor: any; setEditor: any; getDisplayName: (id: string) => string }) {
  const { refs, auth, ui, apiBase, editor, setEditor, getDisplayName } = params;
  const { buildParticipantList, applyVolumesToUi } = useParticipants({
    avRef: refs.avRef, zoneRef: refs.zoneRef, localPosRef: refs.localPosRef, remotesRef: refs.remotesRef,
    colyseusToLivekitMap: refs.colyseusToLivekitMap, identityToNameMap: refs.identityToNameMap,
    volumeRef: refs.volumeRef, me: auth.me, setUiParticipants: ui.setUiParticipants,
    disposedRef: refs.disposedRef, getDisplayName, gameBridge: gameBridge as any, dndRef: refs.dndRef,
  });
  useParticipantListEffects({ refs, me: auth.me, buildParticipantList });
  const recovery = useWorldRealtimeHooks({
    apiBase, authChecked: auth.authChecked, me: auth.me, refs, ui, editor, setEditor,
    buildParticipantList, applyVolumesToUi,
  });
  return { buildParticipantList, applyVolumesToUi, recovery };
}

function useWorldFlows(params: any) {
  const { apiBase, refs, ui, auth, editor, setEditor, recovery, saveAllToServer, useEscapeHandlers, buildParticipantList, applyVolumesToUi } = params;

  useWorldDataHooks({
    apiBase, me: auth.me, refs, ui, editor, setEditor,
    authRefetchTrigger: auth.authRefetchTrigger,
    setAuth: { setMe: auth.setMe, setIsInternalOwner: auth.setIsInternalOwner, setCapabilities: auth.setCapabilities, setPositionReady: auth.setPositionReady, setAuthChecked: auth.setAuthChecked, authChecked: auth.authChecked },
    buildParticipantList, applyVolumesToUi,
  });

  const { activateBubbleNow } = useWorldBubble(refs, ui, applyVolumesToUi);
  useHudTickerWithBubble({ authChecked: auth.authChecked, me: auth.me, refs, setHud: ui.setHud, buildParticipantList, activateBubbleNow });
  useEscapeHandlers(ui.setContextMenu, ui.selectedSid, ui.setSelectedSid, ui.setOverlayZoom);

  usePushToTalk({
    enabled: useAvSettingsStore(s => s.settings.pushToTalk),
    pttKey: useAvSettingsStore(s => s.settings.pushToTalkKey),
    isDnd: ui.avState.dnd,
    avRef: refs.avRef,
  });

  const { eventHandlers, pttAwareToggleMic } = useWorldEventBundle({
    apiBase, refs, ui, auth, editor, applyVolumesToUi, saveAllToServer,
    handleConnectionReload: recovery.handleReload, dismissBanner: recovery.dismissBanner,
  });

  return { eventHandlers, pttAwareToggleMic };
}

export function useWorldAppCore(params: {
  refs: any;
  auth: any;
  ui: any;
  apiBase: string;
  useBillingAvailability: (apiBase: string, setBillingAvailable: (v: boolean) => void) => void;
  useCameraManualSync: (setCameraManual: any) => void;
  useDisposedFlag: (disposedRef: any) => void;
  useAvailableMaps: (me: any, apiBase: string) => void;
  useEscapeHandlers: (setContextMenu: any, selectedSid: string | null, setSelectedSid: any, setOverlayZoom: any) => void;
  saveAllToServerImpl: (apiBase: string, editor: any, colyseusRef: any) => Promise<boolean>;
}) {
  const { refs, auth, ui, apiBase, useBillingAvailability, useCameraManualSync, useDisposedFlag, useAvailableMaps, useEscapeHandlers, saveAllToServerImpl } = params;
  const [editor, setEditor] = useEditor();

  const isTenantAdmin = auth.me?.role === 'owner' || auth.me?.role === 'admin';
  const { paymentStatus, handleManageBilling } = usePaymentStatus({ enabled: auth.isInternalOwner });

  useBillingAvailability(apiBase, auth.setBillingAvailable);
  useCameraManualSync(ui.setCameraManual);
  useDisposedFlag(refs.disposedRef);
  useWorldEditorActiveSync(refs, editor.active);

  const getDisplayName = useCallback((identity: string): string => {
    const name = refs.identityToNameMap.current[identity];
    if (name) return name;
    if (auth.me && identity === auth.me.id) return auth.me.name || auth.me.email;
    return identity;
  }, [auth.me, refs.identityToNameMap]);

  const { buildParticipantList, applyVolumesToUi, recovery } = useWorldParticipantsAndRealtime({ refs, auth, ui, apiBase, editor, setEditor, getDisplayName });
  const desktop = useDesktop();
  const getRoom = useCallback(() => refs.avRef.current?.room, [refs.avRef]);
  useAvailableMaps(auth.me, apiBase);
  const saveAllToServer = useCallback(() => saveAllToServerImpl(apiBase, editor, refs.colyseusRef), [apiBase, editor, refs.colyseusRef]);

  const { eventHandlers, pttAwareToggleMic } = useWorldFlows({
    apiBase, refs, ui, auth, editor, setEditor, recovery, saveAllToServer, useEscapeHandlers, buildParticipantList, applyVolumesToUi,
  });

  useDesktopShortcuts({ isTauri: desktop.isTauri, toggleMiniMode: desktop.toggleMiniMode, setTauriPrefsOpen: desktop.setTauriPrefsOpen });
  useMicShortcut(pttAwareToggleMic);

  const helpers = useWorldUiHelpers({ refs, ui, auth, toggleMiniMode: desktop.toggleMiniMode });

  return {
    editor, setEditor,
    isTenantAdmin, paymentStatus, handleManageBilling,
    showReloadBanner: recovery.showReloadBanner,
    desktop, getRoom, saveAllToServer,
    eventHandlers, pttAwareToggleMic,
    getDisplayName,
    ...helpers,
  };
}
