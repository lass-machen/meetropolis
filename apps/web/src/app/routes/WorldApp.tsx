import React, { useEffect, useRef } from 'react';
import { gameBridge } from '../../game/bridge';
import { getApiBaseFromWindow } from '../../lib/runtimeConfig';
import { logger } from '../../lib/logger';
import { BubbleManager } from '../../game/bubbleManager';
import { FollowManager } from '../../game/followManager';
import { ZoneManager } from '../../game/zoneManager';
import { VolumeManager } from '../../game/volumeManager';
import { EditorService } from '../../services/EditorService';
import { useMapStore } from '../../state/mapStore';
import { usePublicConfigStore } from '../../state/publicConfigStore';
import { AuthLoadingScreen } from './components/AuthLoadingScreen';
import { WorldShell } from './components/WorldShell';
import { DEFAULT_CAPABILITIES } from './hooks/useFetchMe';
import type { AdminCapabilities } from './hooks/useFetchMe';
import { useWorldAppCore } from './hooks/useWorldAppCore';

function useWorldRefs() {
  return {
    containerRef: useRef<HTMLDivElement>(null!),
    colyseusRef: useRef<any>(null),
    colyseusReconnectTimerRef: useRef<any>(null),
    avRef: useRef<any>(null),
    bubbleRef: useRef<BubbleManager | null>(null),
    zoneRef: useRef<ZoneManager | null>(null),
    followRef: useRef<FollowManager | null>(null),
    volumeRef: useRef<VolumeManager | null>(null),
    bubbleMembersRef: useRef<Set<string>>(new Set()),
    bubbleGroupsRef: useRef<Record<string, string>>({}),
    localPosRef: useRef<{ id: string; x?: number; y?: number }>({ id: '' }),
    remotesRef: useRef<Record<string, { x: number; y: number; dnd?: boolean; avatarId?: string }>>({}),
    colyseusToLivekitMap: useRef<Record<string, string>>({}),
    identityToNameMap: useRef<Record<string, string>>({}),
    participantVolumesRef: useRef<Record<string, number>>({}),
    dndRef: useRef<boolean>(false),
    rosterByIdentityRef: useRef<Record<string, { name: string; x: number; y: number }>>({}),
    bubblePendingRef: useRef<{ targetId: string; dest?: { x: number; y: number } } | null>(null),
    bubbleStartRef: useRef<null | ((id: string) => void)>(null),
    manualNavRef: useRef<{ x: number; y: number } | null>(null),
    disposedRef: useRef(false),
    gameCreatedRef: useRef(false),
    lastSavedPositionRef: useRef({ x: 0, y: 0, direction: 'down' }),
    moveTimeoutRef: useRef<any>(null),
    buildListTimerRef: useRef<any>(null),
    buildListRafRef: useRef<number | null>(null),
    lastAutoFullscreenRef: useRef<number>(0),
    editorActiveRef: useRef(false),
    activateBubbleNowRef: useRef<(id: string) => void>(() => {}),
  };
}

function useAuthState() {
  const [authChecked, setAuthChecked] = React.useState(false);
  const [me, setMe] = React.useState<{
    id: string;
    email: string;
    name?: string;
    onboardingCompleted?: boolean;
    role?: string;
  } | null>(null);
  const [isInternalOwner, setIsInternalOwner] = React.useState(false);
  const [capabilities, setCapabilities] = React.useState<AdminCapabilities>(DEFAULT_CAPABILITIES);
  const [authRefetchTrigger, setAuthRefetchTrigger] = React.useState(0);
  const [positionReady, setPositionReady] = React.useState(false);
  const [billingAvailable, setBillingAvailable] = React.useState(false);
  return {
    authChecked,
    setAuthChecked,
    me,
    setMe,
    isInternalOwner,
    setIsInternalOwner,
    capabilities,
    setCapabilities,
    authRefetchTrigger,
    setAuthRefetchTrigger,
    positionReady,
    setPositionReady,
    billingAvailable,
    setBillingAvailable,
  };
}

function useUiPanels() {
  const [hud, setHud] = React.useState<{ zone?: string; follow?: string | null; avRoom?: string | null }>({});
  const [devices, setDevices] = React.useState<{
    mics: { id: string; label: string }[];
    cams: { id: string; label: string }[];
  }>({ mics: [], cams: [] });
  const [avState, setAvState] = React.useState<{ mic: boolean; cam: boolean; share: boolean; dnd: boolean }>({
    mic: false,
    cam: false,
    share: false,
    dnd: false,
  });
  const [selectedMicId, setSelectedMicId] = React.useState<string>('');
  const [selectedCamId, setSelectedCamId] = React.useState<string>('');
  const [uiParticipants, setUiParticipants] = React.useState<
    {
      sid: string;
      identity: string;
      hasVideo: boolean;
      hasMic: boolean;
      isSpeaking: boolean;
      media: 'camera' | 'screen';
      volume?: number;
    }[]
  >([]);
  const [cameraManual, setCameraManual] = React.useState(false);
  const [tenantTab, setTenantTab] = React.useState('general');
  const [roster, setRoster] = React.useState<
    Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>
  >([]);
  const [apiModalOpen, setApiModalOpen] = React.useState(false);
  const [apiTokens, setApiTokens] = React.useState<
    { id: string; name?: string | null; createdAt: string; lastUsedAt?: string | null }[]
  >([]);
  const [newTokenName, setNewTokenName] = React.useState('');
  const [freshToken, setFreshToken] = React.useState<string | null>(null);
  const [adminOpen, setAdminOpen] = React.useState(false);
  const [billingOpen, setBillingOpen] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);
  const [tenantSettingsOpen, setTenantSettingsOpen] = React.useState(false);
  const [sessionsOpen, setSessionsOpen] = React.useState(false);
  const [packStoreOpen, setPackStoreOpen] = React.useState(false);
  const [gridExpanded, setGridExpanded] = React.useState(() => {
    const stored = localStorage.getItem('uc-container-expanded');
    return stored !== null ? stored === 'true' : true;
  });
  const [selectedSid, setSelectedSid] = React.useState<string | null>(null);
  const [overlayZoom, setOverlayZoom] = React.useState(1);
  const [connStatus, setConnStatus] = React.useState<{ reconnecting: boolean; lastCode?: number; lastReason?: string }>(
    { reconnecting: false },
  );
  const [rosterCollapsed, setRosterCollapsed] = React.useState(false);
  const [bubbleUi, setBubbleUi] = React.useState<{ active: boolean; members: string[] }>({
    active: false,
    members: [],
  });
  const [contextMenu, setContextMenu] = React.useState<{
    open: boolean;
    x: number;
    y: number;
    playerId: string | null;
  }>({ open: false, x: 0, y: 0, playerId: null });
  const [page, setPage] = React.useState<string>('world');
  const [menuOpen, setMenuOpen] = React.useState(false);
  return {
    hud,
    setHud,
    devices,
    setDevices,
    avState,
    setAvState,
    selectedMicId,
    setSelectedMicId,
    selectedCamId,
    setSelectedCamId,
    uiParticipants,
    setUiParticipants,
    cameraManual,
    setCameraManual,
    tenantTab,
    setTenantTab,
    roster,
    setRoster,
    apiModalOpen,
    setApiModalOpen,
    apiTokens,
    setApiTokens,
    newTokenName,
    setNewTokenName,
    freshToken,
    setFreshToken,
    adminOpen,
    setAdminOpen,
    billingOpen,
    setBillingOpen,
    profileOpen,
    setProfileOpen,
    tenantSettingsOpen,
    setTenantSettingsOpen,
    sessionsOpen,
    setSessionsOpen,
    packStoreOpen,
    setPackStoreOpen,
    gridExpanded,
    setGridExpanded,
    selectedSid,
    setSelectedSid,
    overlayZoom,
    setOverlayZoom,
    connStatus,
    setConnStatus,
    rosterCollapsed,
    setRosterCollapsed,
    bubbleUi,
    setBubbleUi,
    contextMenu,
    setContextMenu,
    page,
    setPage,
    menuOpen,
    setMenuOpen,
  };
}

function useBillingAvailability(_apiBase: string, setBillingAvailable: (v: boolean) => void) {
  const billingEnabled = usePublicConfigStore((s) => s.billingEnabled);
  const loaded = usePublicConfigStore((s) => s.loaded);
  React.useEffect(() => {
    if (!loaded) return;
    setBillingAvailable(billingEnabled);
  }, [billingEnabled, loaded, setBillingAvailable]);
}

function useCameraManualSync(setCameraManual: React.Dispatch<React.SetStateAction<boolean>>) {
  React.useEffect(() => {
    const handler = (active: boolean) => setCameraManual(!!active);
    try {
      (gameBridge as any).onCameraManualChange = handler;
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
    return () => {
      try {
        (gameBridge as any).onCameraManualChange = () => {};
      } catch (e) {
        logger.debug('[WorldApp] Operation failed', e);
      }
    };
  }, [setCameraManual]);
}

function useDisposedFlag(disposedRef: React.MutableRefObject<boolean>) {
  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, [disposedRef]);
}

function useAvailableMaps(me: any, apiBase: string) {
  React.useEffect(() => {
    if (!me) return;
    fetch(`${apiBase}/maps`, { credentials: 'include' })
      .then((res) => res.json())
      .then((maps) => {
        if (Array.isArray(maps)) {
          useMapStore
            .getState()
            .setAvailableMaps(
              maps.map((m: Record<string, unknown>) => ({ id: m.id as string, name: m.name as string })),
            );
        }
      })
      .catch((e) => logger.debug('[WorldApp] Failed to load available maps', e));
  }, [me, apiBase]);
}

function useEscapeHandlers(
  setContextMenu: React.Dispatch<React.SetStateAction<any>>,
  selectedSid: string | null,
  setSelectedSid: React.Dispatch<React.SetStateAction<string | null>>,
  setOverlayZoom: React.Dispatch<React.SetStateAction<number>>,
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu({ open: false, x: 0, y: 0, playerId: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setContextMenu]);
  useEffect(() => {
    if (!selectedSid) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedSid(null);
        setOverlayZoom(1);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [selectedSid, setSelectedSid, setOverlayZoom]);
}

async function saveAllToServerImpl(apiBase: string, editor: any, colyseusRef: React.RefObject<any>) {
  try {
    const currentState = EditorService.getState();
    const tilesets = currentState.tilesets || editor.tilesets || [];
    const zones = currentState.zones || editor.zones;
    const backgroundColor = currentState.backgroundColor || editor.backgroundColor || '#202020';
    const spawn = currentState.spawn || editor.spawn || undefined;
    const mapId = useMapStore.getState().currentMapId;
    if (!mapId) return false;
    const payload: any = { tilesets, zones, backgroundColor, replaceZones: true };
    if (spawn && typeof spawn.x === 'number' && typeof spawn.y === 'number') payload.spawn = spawn;
    const res = await fetch(`${apiBase}/maps/${encodeURIComponent(mapId)}/editor-state`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      try {
        window.dispatchEvent(
          new CustomEvent('editor:toast', {
            detail: {
              title: 'Speichern fehlgeschlagen',
              description: `Server antwortete mit ${res.status}`,
              intent: 'error',
            },
          }),
        );
      } catch (e) {
        logger.debug('[WorldApp] Operation failed', e);
      }
      return false;
    }
    colyseusRef.current?.send?.('editor_update', { type: 'reload_all' });
    return true;
  } catch {
    try {
      window.dispatchEvent(
        new CustomEvent('editor:toast', {
          detail: { title: 'Speichern fehlgeschlagen', description: 'Netzwerk- oder Serverfehler', intent: 'error' },
        }),
      );
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
    return false;
  }
}

export function WorldApp() {
  const refs = useWorldRefs();
  const auth = useAuthState();
  const ui = useUiPanels();
  const apiBase = getApiBaseFromWindow();

  const core = useWorldAppCore({
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
  });

  if (!auth.authChecked || !auth.me || !auth.positionReady) {
    return (
      <AuthLoadingScreen
        authChecked={auth.authChecked}
        me={auth.me}
        positionReady={auth.positionReady}
        apiBase={apiBase}
        onAuthComplete={core.handleAuthComplete}
      />
    );
  }

  const isMini = core.desktop.isMiniMode && core.desktop.isTauri;
  const me = auth.me;

  return (
    <WorldShell
      isMini={isMini}
      desktop={core.desktop.desktop}
      toggleMiniMode={() => {
        void core.desktop.toggleMiniMode();
      }}
      tauriPrefsOpen={core.desktop.tauriPrefsOpen}
      setTauriPrefsOpen={core.desktop.setTauriPrefsOpen}
      apiBase={apiBase}
      me={me}
      refs={refs}
      ui={ui}
      auth={auth}
      editor={core.editor}
      eventHandlers={core.eventHandlers}
      getRoom={core.getRoom}
      saveAllToServer={core.saveAllToServer}
      handleAuthComplete={() => {
        void core.handleAuthComplete();
      }}
      pttAwareToggleMic={core.pttAwareToggleMic}
      participantsToRender={core.participantsToRender}
      isTenantAdmin={core.isTenantAdmin}
      paymentStatus={core.paymentStatus}
      handleManageBilling={core.handleManageBilling}
      showReloadBanner={core.showReloadBanner}
      getDisplayName={core.getDisplayName}
      getMiniZones={core.getMiniZones}
      handleExpandWithScreen={core.handleExpandWithScreen}
    />
  );
}
