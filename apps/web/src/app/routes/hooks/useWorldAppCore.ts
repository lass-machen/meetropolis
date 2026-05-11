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
import type { WorldRefs, WorldUi, WorldAuth, WorldAppState } from './useWorldAppState';
import type { EditorState } from '../../../services/EditorService';
import type { WorldRoom } from '../../../types/colyseus';
import type { AVManager as AVManagerInterface } from '../../../types/av';
import type { AVManager as AVManagerClass } from '../../../av/avManager';

type SetEditor = React.Dispatch<React.SetStateAction<EditorState>>;

// useParticipants uses the interface from `types/av` (room: Room | null),
// while WorldAppState.avRef holds the concrete class from `av/avManager`
// (room: Room | undefined). The structural difference is benign at runtime so
// we widen the ref type via a cast at the boundary.
function asInterfaceAvRef(
  ref: React.RefObject<AVManagerClass | null>,
): React.MutableRefObject<AVManagerInterface | null> {
  return ref as unknown as React.MutableRefObject<AVManagerInterface | null>;
}

function useWorldEditorActiveSync(refs: WorldRefs, editorActive: boolean) {
  React.useEffect(() => {
    refs.editorActiveRef.current = editorActive;
  }, [editorActive, refs.editorActiveRef]);
  React.useEffect(() => {
    gameBridge.setCollisionVisible(!!editorActive);
  }, [editorActive]);
}

function useWorldParticipantsAndRealtime(params: {
  refs: WorldRefs;
  auth: WorldAuth;
  ui: WorldUi;
  apiBase: string;
  editor: EditorState;
  setEditor: SetEditor;
  getDisplayName: (id: string) => string;
}) {
  const { refs, auth, ui, apiBase, editor, setEditor, getDisplayName } = params;
  const { buildParticipantList, applyVolumesToUi } = useParticipants({
    avRef: asInterfaceAvRef(refs.avRef),
    zoneRef: refs.zoneRef,
    localPosRef: refs.localPosRef,
    remotesRef: refs.remotesRef,
    colyseusToLivekitMap: refs.colyseusToLivekitMap,
    identityToNameMap: refs.identityToNameMap,
    volumeRef: refs.volumeRef,
    me: auth.me,
    setUiParticipants: ui.setUiParticipants,
    disposedRef: refs.disposedRef,
    getDisplayName,
    gameBridge,
    dndRef: refs.dndRef,
  });
  useParticipantListEffects({ refs, me: auth.me, buildParticipantList });
  const recovery = useWorldRealtimeHooks({
    apiBase,
    authChecked: auth.authChecked,
    me: auth.me,
    refs,
    ui,
    editor,
    setEditor,
    buildParticipantList,
    applyVolumesToUi,
  });
  return { buildParticipantList, applyVolumesToUi, recovery };
}

interface UseWorldFlowsParams {
  apiBase: string;
  refs: WorldRefs;
  ui: WorldUi;
  auth: WorldAuth;
  editor: EditorState;
  setEditor: SetEditor;
  recovery: { handleReload: () => void; dismissBanner: () => void };
  saveAllToServer: () => Promise<boolean>;
  useEscapeHandlers: (
    setContextMenu: WorldUi['setContextMenu'],
    selectedSid: string | null,
    setSelectedSid: WorldUi['setSelectedSid'],
    setOverlayZoom: WorldUi['setOverlayZoom'],
  ) => void;
  buildParticipantList: () => void;
  applyVolumesToUi: () => void;
}

function useWorldFlows(params: UseWorldFlowsParams) {
  const {
    apiBase,
    refs,
    ui,
    auth,
    editor,
    setEditor,
    recovery,
    saveAllToServer,
    useEscapeHandlers,
    buildParticipantList,
    applyVolumesToUi,
  } = params;

  useWorldDataHooks({
    apiBase,
    me: auth.me,
    refs,
    ui,
    editor,
    setEditor,
    authRefetchTrigger: auth.authRefetchTrigger,
    setAuth: {
      setMe: auth.setMe,
      setIsInternalOwner: auth.setIsInternalOwner,
      setCapabilities: auth.setCapabilities,
      setPositionReady: auth.setPositionReady,
      setAuthChecked: auth.setAuthChecked,
      authChecked: auth.authChecked,
    },
    buildParticipantList,
    applyVolumesToUi,
  });

  const { activateBubbleNow } = useWorldBubble(refs, ui, applyVolumesToUi);
  useHudTickerWithBubble({
    authChecked: auth.authChecked,
    me: auth.me,
    refs,
    setHud: ui.setHud,
    buildParticipantList,
    activateBubbleNow,
  });
  useEscapeHandlers(ui.setContextMenu, ui.selectedSid, ui.setSelectedSid, ui.setOverlayZoom);

  usePushToTalk({
    enabled: useAvSettingsStore((s) => s.settings.pushToTalk),
    pttKey: useAvSettingsStore((s) => s.settings.pushToTalkKey),
    isDnd: ui.avState.dnd,
    avRef: refs.avRef,
  });

  const { eventHandlers, pttAwareToggleMic } = useWorldEventBundle({
    apiBase,
    refs,
    ui,
    auth,
    editor,
    applyVolumesToUi,
    saveAllToServer,
    handleConnectionReload: recovery.handleReload,
    dismissBanner: recovery.dismissBanner,
  });

  return { eventHandlers, pttAwareToggleMic };
}

export function useWorldAppCore(params: {
  refs: WorldRefs;
  auth: WorldAuth;
  ui: WorldUi;
  apiBase: string;
  useBillingAvailability: (apiBase: string, setBillingAvailable: (v: boolean) => void) => void;
  useCameraManualSync: (setCameraManual: WorldUi['setCameraManual']) => void;
  useDisposedFlag: (disposedRef: WorldRefs['disposedRef']) => void;
  useAvailableMaps: (me: WorldAppState['me'], apiBase: string) => void;
  useEscapeHandlers: (
    setContextMenu: WorldUi['setContextMenu'],
    selectedSid: string | null,
    setSelectedSid: WorldUi['setSelectedSid'],
    setOverlayZoom: WorldUi['setOverlayZoom'],
  ) => void;
  saveAllToServerImpl: (
    apiBase: string,
    editor: EditorState,
    colyseusRef: React.RefObject<WorldRoom | null>,
  ) => Promise<boolean>;
}) {
  const {
    refs,
    auth,
    ui,
    apiBase,
    useBillingAvailability,
    useCameraManualSync,
    useDisposedFlag,
    useAvailableMaps,
    useEscapeHandlers,
    saveAllToServerImpl,
  } = params;
  const [editor, setEditor] = useEditor();

  const isTenantAdmin = auth.me?.role === 'owner' || auth.me?.role === 'admin';
  const { paymentStatus, handleManageBilling } = usePaymentStatus({ enabled: auth.isInternalOwner });

  useBillingAvailability(apiBase, auth.setBillingAvailable);
  useCameraManualSync(ui.setCameraManual);
  useDisposedFlag(refs.disposedRef);
  useWorldEditorActiveSync(refs, editor.active);

  const getDisplayName = useCallback(
    (identity: string): string => {
      const name = refs.identityToNameMap.current[identity];
      if (name) return name;
      if (auth.me && identity === auth.me.id) return auth.me.name || auth.me.email;
      return identity;
    },
    [auth.me, refs.identityToNameMap],
  );

  const { buildParticipantList, applyVolumesToUi, recovery } = useWorldParticipantsAndRealtime({
    refs,
    auth,
    ui,
    apiBase,
    editor,
    setEditor,
    getDisplayName,
  });
  const desktop = useDesktop();
  const getRoom = useCallback(() => refs.avRef.current?.room, [refs.avRef]);
  useAvailableMaps(auth.me, apiBase);
  const saveAllToServer = useCallback(
    () => saveAllToServerImpl(apiBase, editor, refs.colyseusRef),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: saveAllToServerImpl is a caller-owned stable ref; capturing it would churn callback identity without behaviour gain
    [apiBase, editor, refs.colyseusRef],
  );

  const { eventHandlers, pttAwareToggleMic } = useWorldFlows({
    apiBase,
    refs,
    ui,
    auth,
    editor,
    setEditor,
    recovery,
    saveAllToServer,
    useEscapeHandlers,
    buildParticipantList,
    applyVolumesToUi,
  });

  const toggleMiniModeVoid = React.useCallback(
    () => {
      void desktop.toggleMiniMode();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: desktop is a stable hook-managed singleton; capturing the full object would defeat method-level memoisation
    [desktop.toggleMiniMode],
  );
  useDesktopShortcuts({
    isTauri: desktop.isTauri,
    toggleMiniMode: toggleMiniModeVoid,
    setTauriPrefsOpen: desktop.setTauriPrefsOpen,
  });
  useMicShortcut(pttAwareToggleMic);

  const helpers = useWorldUiHelpers({ refs, ui, auth, toggleMiniMode: toggleMiniModeVoid });

  return {
    editor,
    setEditor,
    isTenantAdmin,
    paymentStatus,
    handleManageBilling,
    showReloadBanner: recovery.showReloadBanner,
    desktop,
    getRoom,
    saveAllToServer,
    eventHandlers,
    pttAwareToggleMic,
    getDisplayName,
    ...helpers,
  };
}
