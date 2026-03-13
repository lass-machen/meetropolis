import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { useEditor } from '../../hooks/useEditor';
import { useApiTokensLoader } from '../../features/admin/useApiTokens';
import { useGlobalAudioTracks } from '../../av/useGlobalAudioTracks';
import { useZones as useZonesSync } from '../../features/zones/useZones';
import { useHudTicker } from '../../features/hud/useHudTicker';
import { useBubbleNavigation } from '../../features/bubble/useBubbleNavigation';
import { useWorldRoom } from '../../realtime/useWorldRoom';
import { useAVManager } from '../../av/hooks/useAVManager';
import { gameBridge } from '../../game/bridge';
import { getApiBaseFromWindow } from '../../lib/runtimeConfig';
import { logger } from '../../lib/logger';
import { useDoNotDisturb } from '../../av/hooks/useDoNotDisturb';
import { usePushToTalk } from '../../av/hooks/usePushToTalk';
import { useAvSettingsStore } from '../../state/avSettings';
import { useScreenshareEvents } from '../../av/hooks/useScreenshareEvents';
import { BubbleManager } from '../../game/bubbleManager';
import { FollowManager } from '../../game/followManager';
import { ZoneManager } from '../../game/zoneManager';
import { VolumeManager } from '../../game/volumeManager';
import { useConnectionRecovery } from '../../hooks/useConnectionRecovery';
import { onAudioTracksChanged } from '../../lib/avEvents';
import { useParticipants } from '../../features/participants/useParticipants';
import { useRosterPresence } from '../../features/roster/useRosterPresence';
import { EditorService } from '../../services/EditorService';
import { useMapStore } from '../../state/mapStore';
import { Overlays } from '../layout/Overlays';
import { RosterPanel } from '../../ui/user/RosterPanel';
import { BubbleBanner } from '../../ui/user/BubbleBanner';
import { EditorWindow } from '../../features/editor/EditorWindow';
import { AdminOverlay } from '../../ui/admin/AdminOverlay';
import { PackStore } from '../../ui/packstore/PackStore';
import { MapSwitcher } from '../../ui/hud/MapSwitcher';
import { MapChangeOverlay } from '../../ui/hud/MapChangeOverlay';
import { AuthLoadingScreen } from './components/AuthLoadingScreen';
import { WorldContextMenu } from './components/WorldContextMenu';
import { WorldModals } from './components/WorldModals';
import { GameCanvas } from './components/GameCanvas';
import { ConnectionBanners } from './components/ConnectionBanners';
import { usePaymentStatus } from '../../ui/billing/hooks/usePaymentStatus';
import { PaymentStatusBanner } from '../../ui/billing/components/PaymentStatusBanner';
import { AVControlBar } from './components/AVControlBar';
import { useWorldEventHandlers } from './hooks/useWorldEventHandlers';
import { useFetchMe } from './hooks/useFetchMe';
import { useEditorLoader } from './hooks/useEditorLoader';
import { useGameInitialization } from './hooks/useGameInitialization';
import { OnboardingWizard } from '../../ui/onboarding/OnboardingWizard';
import { useDesktop } from './hooks/useDesktop';

export function WorldApp() {
  // Refs
  const containerRef = useRef<HTMLDivElement>(null!);
  const colyseusRef = useRef<any>(null);
  const colyseusReconnectTimerRef = useRef<any>(null);
  const avRef = useRef<any>(null);
  const bubbleRef = useRef<BubbleManager | null>(null);
  const zoneRef = useRef<ZoneManager | null>(null);
  const followRef = useRef<FollowManager | null>(null);
  const volumeRef = useRef<VolumeManager | null>(null);
  const bubbleMembersRef = useRef<Set<string>>(new Set());
  const bubbleGroupsRef = useRef<Record<string, string>>({});
  const localPosRef = useRef<{ id: string; x?: number; y?: number }>({ id: '' });
  const remotesRef = useRef<Record<string, { x: number; y: number; dnd?: boolean; avatarId?: string }>>({});
  const colyseusToLivekitMap = useRef<Record<string, string>>({});
  const identityToNameMap = useRef<Record<string, string>>({});
  const participantVolumesRef = useRef<Record<string, number>>({});
  const dndRef = useRef<boolean>(false);
  const rosterByIdentityRef = useRef<Record<string, { name: string; x: number; y: number }>>({});
  const bubblePendingRef = useRef<{ targetId: string; dest?: { x: number; y: number } } | null>(null);
  const bubbleStartRef = useRef<null | ((id: string) => void)>(null);
  const manualNavRef = useRef<{ x: number; y: number } | null>(null);
  const disposedRef = useRef(false);
  const gameCreatedRef = useRef(false);
  const lastSavedPositionRef = useRef({ x: 0, y: 0, direction: 'down' });
  const moveTimeoutRef = useRef<any>(null);
  const buildListTimerRef = useRef<any>(null);
  const buildListRafRef = useRef<number | null>(null);
  const lastAutoFullscreenRef = useRef<number>(0);
  const editorActiveRef = useRef(false);
  const activateBubbleNowRef = useRef<(id: string) => void>(() => { });

  // State
  const [authChecked, setAuthChecked] = React.useState(false);
  const [me, setMe] = React.useState<{ id: string; email: string; name?: string; onboardingCompleted?: boolean } | null>(null);
  const [isInternalOwner, setIsInternalOwner] = React.useState(false);
  const { paymentStatus, handleManageBilling } = usePaymentStatus({ enabled: isInternalOwner });
  const [authRefetchTrigger, setAuthRefetchTrigger] = React.useState(0);
  const [editor, setEditor] = useEditor();

  // UI State
  const [hud, setHud] = React.useState<{ zone?: string; follow?: string | null; avRoom?: string | null }>({});
  const [devices, setDevices] = React.useState<{ mics: { id: string; label: string }[]; cams: { id: string; label: string }[] }>({ mics: [], cams: [] });
  const [avState, setAvState] = React.useState<{ mic: boolean; cam: boolean; share: boolean; dnd: boolean }>({ mic: false, cam: false, share: false, dnd: false });
  const [selectedMicId, setSelectedMicId] = React.useState<string | ''>('');
  const [selectedCamId, setSelectedCamId] = React.useState<string | ''>('');
  const [uiParticipants, setUiParticipants] = React.useState<{ sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen'; volume?: number }[]>([]);
  const [cameraManual, setCameraManual] = React.useState(false);
  const [userModalOpen, setUserModalOpen] = React.useState(false);
  const [invitesModalOpen, setInvitesModalOpen] = React.useState(false);
  const [roster, setRoster] = React.useState<Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>>([]);
  const [positionReady, setPositionReady] = React.useState(false);
  const [apiModalOpen, setApiModalOpen] = React.useState(false);
  const [apiTokens, setApiTokens] = React.useState<{ id: string; name?: string | null; createdAt: string; lastUsedAt?: string | null }[]>([]);
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
  const [connStatus, setConnStatus] = React.useState<{ reconnecting: boolean; lastCode?: number; lastReason?: string }>({ reconnecting: false });
  const [rosterCollapsed, setRosterCollapsed] = React.useState(false);
  const [bubbleUi, setBubbleUi] = React.useState<{ active: boolean; members: string[] }>({ active: false, members: [] });
  const [contextMenu, setContextMenu] = React.useState<{ open: boolean; x: number; y: number; playerId: string | null }>({ open: false, x: 0, y: 0, playerId: null });
  const [page, setPage] = React.useState<'world' | 'admin' | string>('world');
  const [menuOpen, setMenuOpen] = React.useState(false);

  const apiBase = getApiBaseFromWindow();

  const getDisplayName = useCallback((identity: string): string => {
    const name = identityToNameMap.current[identity];
    if (name) return name;
    if (me && identity === me.id) return me.name || me.email;
    return identity;
  }, [me]);

  // Camera manual change handler
  React.useEffect(() => {
    const handler = (active: boolean) => setCameraManual(!!active);
    try { (gameBridge as any).onCameraManualChange = handler; } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    return () => { try { (gameBridge as any).onCameraManualChange = () => { }; } catch (e) { logger.debug('[WorldApp] Operation failed', e); } };
  }, []);

  // Disposed flag
  useEffect(() => {
    disposedRef.current = false;
    return () => { disposedRef.current = true; };
  }, []);

  // Editor active ref sync
  React.useEffect(() => { editorActiveRef.current = editor.active; }, [editor.active]);

  // Participants hook
  const { buildParticipantList, applyVolumesToUi } = useParticipants({
    avRef, zoneRef, localPosRef, remotesRef, colyseusToLivekitMap, identityToNameMap,
    volumeRef, me, setUiParticipants,
    disposedRef, getDisplayName, gameBridge, dndRef,
  });

  // Rebuild participant list when me changes to ensure UserCard shows display name, not UUID
  React.useEffect(() => {
    if (me) {
      const localIdentity = avRef.current?.room?.localParticipant?.identity || me.id;
      identityToNameMap.current[localIdentity] = me.name || me.email || me.id;
      buildParticipantList();
    }
  }, [me, buildParticipantList]);

  // Cleanup build list timers
  React.useEffect(() => {
    return () => {
      try { if (buildListTimerRef.current) clearTimeout(buildListTimerRef.current); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      try { if (buildListRafRef.current !== null) cancelAnimationFrame(buildListRafRef.current); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    };
  }, []);

  // API Tokens loader
  useApiTokensLoader({ apiBase, open: apiModalOpen, setFreshToken, setApiTokens });

  // DND Hook
  useDoNotDisturb({ enabled: !!(authChecked && me), avRef, dndRef, setAvState, colyseusRef });

  // Roster Presence
  useRosterPresence({ apiBase, authChecked, meId: me?.id ?? null, rosterByIdentityRef, setRoster, avRef });

  // AV Manager
  useAVManager({
    apiBase, me, editorActiveRef, avRef, setDevices, setSelectedMicId, setSelectedCamId,
    buildParticipantList,
  });

  // Screenshare events
  useScreenshareEvents({
    avRef,
    enabled: !!(authChecked && me && !editor.active && !avState.dnd),
    onRemoteScreenshareStart: React.useCallback((participantSid: string) => {
      const now = Date.now();
      if (selectedSid) return;
      if (now - lastAutoFullscreenRef.current < 5000) return;
      lastAutoFullscreenRef.current = now;
      const screenSid = participantSid + ':screen';
      setSelectedSid(screenSid);
      setOverlayZoom(1);
      setTimeout(() => buildParticipantList(), 200);
    }, [selectedSid, buildParticipantList]),
    onRemoteScreenshareStop: React.useCallback((participantSid: string) => {
      const screenSid = participantSid + ':screen';
      if (selectedSid === screenSid) {
        setSelectedSid(null);
        setOverlayZoom(1);
      }
    }, [selectedSid]),
  });

  // Desktop integration (optional, loaded via desktopLoader)
  const { isTauri, isMiniMode, toggleMiniMode, tauriPrefsOpen, setTauriPrefsOpen, desktop } = useDesktop();

  // Connection Recovery
  const { showReloadBanner, handleReload, dismissBanner } = useConnectionRecovery({
    enabled: !!(authChecked && me), colyseusRef,
    onConnectionLost: () => logger.warn('[WorldApp] Colyseus connection lost'),
    onConnectionRestored: () => {
      logger.debug('[WorldApp] Colyseus connection restored');
      setTimeout(() => buildParticipantList(), 500);
    },
  });

  // World Room (Colyseus)
  useWorldRoom({
    apiBase, me, avRef, colyseusRef, localPosRef, remotesRef, colyseusToLivekitMap,
    identityToNameMap, gameBridge, editor, setEditor, zoneRef, buildParticipantList,
    applyVolumesToUi, setBubbleUi, bubbleMembersRef, bubbleGroupsRef, dndRef, setAvState,
    rosterByIdentityRef, setRoster, disposedRef, setConnectionStatus: setConnStatus,
  });

  const getRoom = useCallback(() => avRef.current?.room, []);

  // Fetch user & position (extracted to hook)
  useFetchMe({ apiBase, localPosRef, setMe, setIsInternalOwner, setPositionReady, setAuthChecked, refetchTrigger: authRefetchTrigger });

  // Load available maps
  React.useEffect(() => {
    if (!me) return;
    fetch(`${apiBase}/maps`, { credentials: 'include' })
      .then(res => res.json())
      .then(maps => {
        if (Array.isArray(maps)) {
          useMapStore.getState().setAvailableMaps(maps.map((m: Record<string, unknown>) => ({ id: m.id as string, name: m.name as string })));
        }
      })
      .catch(e => logger.debug('[WorldApp] Failed to load available maps', e));
  }, [me, apiBase]);

  // Reload zones after map change
  React.useEffect(() => {
    if (!me) return;
    const handler = async (e: Event) => {
      const mapId = (e as CustomEvent).detail?.mapId;
      if (!mapId) return;
      // Reset ZoneManager state immediately (before async fetch) so stale
      // portal-zone tracking from the previous map doesn't block re-entry.
      zoneRef.current?.resetForMapChange?.();
      try {
        const res = await fetch(`${apiBase}/maps/${encodeURIComponent(mapId)}/editor-state?t=${Date.now()}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data?.zones)) {
          const zones = data.zones.map((z: any) => ({
            name: z.name,
            points: Array.isArray(z.points) ? z.points : Array.isArray(z.polygon) ? z.polygon : [],
            capacity: z.capacity ?? undefined,
            type: z.type ?? undefined,
            portalTarget: z.portalTarget ?? undefined,
            portalSpawnX: z.portalSpawnX ?? undefined,
            portalSpawnY: z.portalSpawnY ?? undefined,
          }));
          setEditor((s: any) => ({ ...s, zones }));
          zoneRef.current?.setZones?.(zones);
        }
      } catch (e) {
        logger.debug('[WorldApp] Failed to reload zones after map change', e);
      }
    };
    window.addEventListener('map_zones_reload', handler);
    return () => window.removeEventListener('map_zones_reload', handler);
  }, [me, apiBase]);

  // Update ZoneManager when server loads zones (play mode - zones aren't in editor state)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const zones = (e as CustomEvent).detail?.zones;
      if (Array.isArray(zones) && zones.length > 0) {
        zoneRef.current?.setZones?.(zones);
      }
    };
    window.addEventListener('server_zones_loaded', handler);
    return () => window.removeEventListener('server_zones_loaded', handler);
  }, []);

  // Load editor state (extracted to hook)
  useEditorLoader({ me, apiBase, setEditor });

  // Reset selection on category change
  React.useEffect(() => {
    setEditor(s => {
      return { ...s, pendingAsset: null, tool: 'select' };
    });
  }, [editor.category]);

  // Tool change: ghost cleanup is handled by EditorRenderer via EditorIntegration
  // No need to call setAssetPreview(null) here as it interferes with ghost management

  async function saveAllToServer() {
    try {
      const currentState = EditorService.getState();
      const tilesets = currentState.tilesets || editor.tilesets || [];
      const zones = currentState.zones || editor.zones;
      const backgroundColor = currentState.backgroundColor || editor.backgroundColor || '#202020';
      const spawn = currentState.spawn || editor.spawn || undefined;
      const mapId = useMapStore.getState().currentMapId;
      if (!mapId) return false;
      const payload: any = { tilesets, zones, backgroundColor, replaceZones: true };
      if (spawn && typeof spawn.x === 'number' && typeof spawn.y === 'number') {
        payload.spawn = spawn;
      }
      const res = await fetch(`${apiBase}/maps/${encodeURIComponent(mapId)}/editor-state`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        try { window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title: 'Speichern fehlgeschlagen', description: `Server antwortete mit ${res.status}`, intent: 'error' } })); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
        return false;
      }
      colyseusRef.current?.send?.('editor_update', { type: 'reload_all' });
      return true;
    } catch {
      try { window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title: 'Speichern fehlgeschlagen', description: 'Netzwerk- oder Serverfehler', intent: 'error' } })); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      return false;
    }
  }

  // Game initialization
  // Game initialization (extracted to hook)
  useGameInitialization({
    authChecked, me, apiBase, containerRef, bubbleRef, followRef, zoneRef, volumeRef,
    gameCreatedRef, editorActiveRef, localPosRef, remotesRef, bubblePendingRef,
    activateBubbleNowRef, manualNavRef, lastSavedPositionRef, moveTimeoutRef, colyseusRef,
    avRef, colyseusToLivekitMap, colyseusReconnectTimerRef, bubbleGroupsRef,
    editor, setEditor, setContextMenu, buildParticipantList, applyVolumesToUi,
  });
  // Global Audio Tracks
  useGlobalAudioTracks({ avRef });
  React.useEffect(() => {
    let off: (() => void) | null = null;
    try {
      off = onAudioTracksChanged?.(() => {
        try { applyVolumesToUi(); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      }) || null;
    } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    return () => { try { off?.(); } catch (e) { logger.debug('[WorldApp] Operation failed', e); } };
  }, []);

  // Zones sync
  useZonesSync({ editor, setEditor, zoneRef, gameBridge, colyseusRef });
  // Bubble Navigation
  const { startBubbleTo, activateBubbleNow } = useBubbleNavigation({
    bubbleMembersRef, localPosRef, colyseusRef, gameBridge, identityToNameMap, colyseusToLivekitMap,
    setBubbleUi, applyVolumesToUi, followRef,
  });
  activateBubbleNowRef.current = activateBubbleNow;
  bubbleStartRef.current = (id: string) => {
    try {
      let dest: { x: number; y: number } | undefined = undefined;
      try {
        const free = gameBridge.findFreeSpotNear(id, { radius: 16, step: 16 });
        if (free) dest = { x: free.x, y: free.y };
      } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      bubblePendingRef.current = dest ? { targetId: id, dest } : { targetId: id };
    } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    try { startBubbleTo(id); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
  };

  // HUD Ticker
  useHudTicker({
    enabled: !!(authChecked && me), zoneRef, avRef, setHud, bubblePendingRef, localPosRef, remotesRef,
    onZoneParticipantRefresh: () => setTimeout(buildParticipantList, 0), volumeRef,
    setParticipantVolumesRef: (vols) => { participantVolumesRef.current = vols; },
    onArrivedAtBubbleTarget: (targetId) => {
      try { followRef.current?.stop?.(); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      try { gameBridge.setDesiredPosition(null); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      try { activateBubbleNow(targetId); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    },
  });

  // Collision visibility
  useEffect(() => { gameBridge.setCollisionVisible(!!editor.active); }, [editor.active]);
  // Escape handlers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu({ open: false, x: 0, y: 0, playerId: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!selectedSid) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setSelectedSid(null); setOverlayZoom(1); }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [selectedSid]);

  // AV state sync
  React.useEffect(() => {
    let removeHandlers: (() => void) | null = null;
    let pollTimer: any = null;
    let watcher: any = null;
    const applyNow = async () => {
      try {
        const mod: any = await import('../../av/core/localState');
        const roomAny: any = avRef.current?.room as any;
        if (!roomAny) return;
        const mic = mod.isLocalMicOn(roomAny);
        const cam = mod.isLocalCamOn(roomAny);
        let share = false;
        try { share = mod.isLocalShareOn(roomAny); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
        setAvState(s => ({ ...s, mic, cam, ...(typeof share === 'boolean' ? { share } : {}) }));
      } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    };
    const installHandlersForRoom = async (room: any) => {
      try {
        const lk: any = await import('livekit-client');
        const RoomEvent = (lk as any).RoomEvent;
        const onAny = () => { void applyNow(); };
        if (RoomEvent) {
          room.on?.(RoomEvent.LocalTrackPublished, onAny);
          room.on?.(RoomEvent.LocalTrackUnpublished, onAny);
          room.on?.(RoomEvent.TrackMuted, onAny);
          room.on?.(RoomEvent.TrackUnmuted, onAny);
          room.on?.(RoomEvent.ConnectionStateChanged, onAny);
          removeHandlers = () => {
            try {
              room.off?.(RoomEvent.LocalTrackPublished, onAny);
              room.off?.(RoomEvent.LocalTrackUnpublished, onAny);
              room.off?.(RoomEvent.TrackMuted, onAny);
              room.off?.(RoomEvent.TrackUnmuted, onAny);
              room.off?.(RoomEvent.ConnectionStateChanged, onAny);
            } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
          };
        } else {
          room.on?.('localTrackPublished', onAny);
          room.on?.('localTrackUnpublished', onAny);
          room.on?.('trackMuted', onAny);
          room.on?.('trackUnmuted', onAny);
          room.on?.('connectionStateChanged', onAny);
          removeHandlers = () => {
            try {
              room.off?.('localTrackPublished', onAny);
              room.off?.('localTrackUnpublished', onAny);
              room.off?.('trackMuted', onAny);
              room.off?.('trackUnmuted', onAny);
              room.off?.('connectionStateChanged', onAny);
            } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
          };
        }
      } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      void applyNow();
    };
    watcher = setInterval(() => {
      const room: any = avRef.current?.room as any;
      if (!room) {
        if (!pollTimer) pollTimer = setInterval(applyNow, 750);
        return;
      }
      try { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      clearInterval(watcher);
      watcher = null;
      void installHandlersForRoom(room);
    }, 500);
    void applyNow();
    return () => {
      try { removeHandlers?.(); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      try { clearInterval(pollTimer); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      try { if (watcher) clearInterval(watcher); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    };
  }, []);

  // Push-to-Talk
  usePushToTalk({
    enabled: useAvSettingsStore(s => s.settings.pushToTalk),
    pttKey: useAvSettingsStore(s => s.settings.pushToTalkKey),
    isDnd: avState.dnd,
    avRef,
  });

  // Event handlers hook
  const eventHandlers = useWorldEventHandlers({
    apiBase, avRef, colyseusRef, localPosRef, remotesRef, bubbleGroupsRef, bubbleMembersRef,
    bubbleStartRef, followRef, manualNavRef, gameBridge, editor, avState, contextMenu,
    setAvState, setMe, setGridExpanded, setSelectedSid, setMenuOpen, setUserModalOpen,
    setInvitesModalOpen, setPage, setAdminOpen, setApiModalOpen, setBillingOpen, setProfileOpen,
    setTenantSettingsOpen, setSessionsOpen, setRosterCollapsed, setBubbleUi, setContextMenu,
    setOverlayZoom, setSelectedMicId, setSelectedCamId, applyVolumesToUi, saveAllToServer,
    handleConnectionReload: handleReload, dismissBanner,
  });

  // Desktop-Effekte: Cmd+M mini-mode, open-preferences
  // Das Desktop-Modul dispatcht Custom Events; der OSS-Code lauscht nur darauf.
  useEffect(() => {
    if (!isTauri) return;
    // Cmd+M → toggle mini mode (Keyboard-Shortcut bleibt im OSS-Code,
    // da es keine @tauri-apps Dependency braucht)
    const handleMiniModeKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        e.stopPropagation();
        toggleMiniMode();
      }
    };
    window.addEventListener('keydown', handleMiniModeKey, true);

    // Desktop-Modul dispatcht 'desktop:open-preferences' Custom Event
    const handleOpenPrefs = () => setTauriPrefsOpen(true);
    window.addEventListener('desktop:open-preferences', handleOpenPrefs);

    return () => {
      window.removeEventListener('keydown', handleMiniModeKey, true);
      window.removeEventListener('desktop:open-preferences', handleOpenPrefs);
    };
  }, [isTauri, toggleMiniMode, setTauriPrefsOpen]);

  // PTT-aware mic toggle: wenn PTT aktiv ist, PTT deaktivieren statt Mic umschalten
  const pttAwareToggleMic = useCallback(async () => {
    const pttOn = useAvSettingsStore.getState().settings.pushToTalk;
    if (pttOn) {
      // PTT deaktivieren → usePushToTalk cleanup setzt track.enabled = true
      useAvSettingsStore.getState().setSetting('pushToTalk', false);
      return;
    }
    await eventHandlers.handleToggleMic();
  }, [eventHandlers.handleToggleMic]);

  // Cmd/Ctrl+D to toggle mic (generisch, funktioniert in allen Umgebungen)
  useEffect(() => {
    if (!pttAwareToggleMic) return;
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        e.stopPropagation();
        pttAwareToggleMic();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [pttAwareToggleMic]);

  const participantsToRender = useMemo(() =>
    uiParticipants.length > 0
      ? uiParticipants
      : [{ sid: (avRef.current?.room?.localParticipant?.sid ?? 'local'), identity: me?.name || me?.email || '', hasVideo: false, hasMic: avState.mic, isSpeaking: false, media: 'camera' as const }],
    [uiParticipants, me?.name, me?.email, avState.mic]
  );

  // Callback to trigger re-fetch of user data after successful login
  const handleAuthComplete = useCallback(async () => {
    // Trigger refetch of user data
    setAuthRefetchTrigger(prev => prev + 1);
  }, []);

  // Zones for mini mode grouping (read from ZoneManager)
  const getMiniZones = useCallback(() => {
    const raw = zoneRef.current?.getZones?.() || [];
    return raw.map((z: any) => ({
      name: z.name as string,
      points: ((z.points || []) as any[])
        .map((p: any) => Array.isArray(p) ? { x: p[0], y: p[1] } : p)
        .filter((p: any) => p && typeof p.x === 'number' && typeof p.y === 'number'),
    }));
  }, []);

  // Expand from mini mode and immediately show a screenshare fullscreen
  const handleExpandWithScreen = useCallback((screenSid: string) => {
    toggleMiniMode();
    setSelectedSid(screenSid);
    setOverlayZoom(1);
  }, [toggleMiniMode, setSelectedSid, setOverlayZoom]);

  // Early return for loading/auth screens
  if (!authChecked || !me || !positionReady) {
    return (
      <AuthLoadingScreen
        authChecked={authChecked}
        me={me}
        positionReady={positionReady}
        apiBase={apiBase}
        onAuthComplete={handleAuthComplete}
      />
    );
  }

  const isMini = isMiniMode && isTauri;

  return (
    <>
      {/* Mini-Modus: Kompakte Team-Call-Ansicht (rendered on top, hides main UI) */}
      {isMini && desktop?.MiniModeView && (
        <desktop.MiniModeView
          roster={roster}
          uiParticipants={uiParticipants}
          avState={avState}
          getDisplayName={getDisplayName}
          onJumpTo={eventHandlers.handleJumpTo}
          onToggleMic={pttAwareToggleMic}
          onToggleCam={eventHandlers.handleToggleCam}
          onToggleDnd={eventHandlers.handleToggleDnd}
          onToggleShare={eventHandlers.handleToggleShare}
          onExpand={toggleMiniMode}
          onExpandWithScreen={handleExpandWithScreen}
          roomGetter={getRoom}
          getZones={getMiniZones}
        />
      )}
    <div style={{
      width: '100vw', height: '100vh', display: 'grid', gridTemplateColumns: '1fr auto',
      ...(isMini ? { visibility: 'hidden' as const, position: 'fixed' as const, inset: 0, pointerEvents: 'none' as const } : {}),
    }}>
      {me.onboardingCompleted === false && (
        <OnboardingWizard
          me={me}
          apiBase={apiBase}
          onComplete={(updates) => {
            setMe(prev => prev ? { ...prev, ...updates } : prev);
          }}
        />
      )}
      <MapChangeOverlay />
      <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
        {page === 'world' && (
          <>
            <Overlays
              hud={hud}
              editorActive={editor.active}
              avDnd={avState.dnd}
              participants={participantsToRender}
              gridExpanded={gridExpanded}
              onToggleExpand={eventHandlers.handleToggleExpand}
              selectedSid={selectedSid}
              onSelectSid={eventHandlers.handleSelectSid}
              getRoom={getRoom}
              overlayZoom={overlayZoom}
              onZoom={(z) => setOverlayZoom(z)}
              topRightMenu={{
                menuOpen,
                onToggleMenu: eventHandlers.handleToggleMenu,
                onOpenUsers: eventHandlers.handleOpenUsers,
                onOpenInvites: eventHandlers.handleOpenInvites,
                onBackToWorld: eventHandlers.handleBackToWorld,
                onOpenAdmin: eventHandlers.handleOpenAdmin,
                isAdmin: isInternalOwner,
                onOpenApi: eventHandlers.handleOpenApi,
                onOpenBilling: eventHandlers.handleOpenBilling,
                onOpenProfile: eventHandlers.handleOpenProfile,
                onOpenTenantSettings: eventHandlers.handleOpenTenantSettings,
                onOpenSessions: eventHandlers.handleOpenSessions,
                onOpenPackStore: () => setPackStoreOpen(true),
                onResetApp: eventHandlers.handleResetApp,
                onToggleEditor: eventHandlers.handleToggleEditor,
                editorActive: editor.active,
                onLogout: eventHandlers.handleLogout,
              }}
            />

            <ConnectionBanners
              isDev={(import.meta as any).env?.DEV}
              connStatus={connStatus}
              showReloadBanner={showReloadBanner}
              onReload={eventHandlers.handleConnectionReloadClick}
              onDismissBanner={eventHandlers.handleDismissBanner}
            />

            {isInternalOwner && paymentStatus && paymentStatus.status !== 'ok' && (
              <PaymentStatusBanner paymentStatus={paymentStatus} onManageBilling={handleManageBilling} />
            )}

            <GameCanvas containerRef={containerRef} positionReady={positionReady} avDnd={avState.dnd} />

            {isInternalOwner && (
              <AdminOverlay apiBase={apiBase} open={adminOpen} onOpenChange={setAdminOpen} />
            )}

            <PackStore apiBase={apiBase} open={packStoreOpen} onOpenChange={setPackStoreOpen} />

            {!editor.active && (
              <div style={{ position: 'absolute', bottom: 70, left: 12, zIndex: 30 }}>
                <MapSwitcher room={connStatus.reconnecting ? null : colyseusRef.current} />
              </div>
            )}

            <AVControlBar
              editorActive={editor.active}
              avState={avState}
              devices={devices}
              selectedMicId={selectedMicId}
              selectedCamId={selectedCamId}
              cameraManual={cameraManual}
              onToggleMic={pttAwareToggleMic}
              onSelectMic={eventHandlers.handleSelectMic}
              onToggleCam={eventHandlers.handleToggleCam}
              onSelectCam={eventHandlers.handleSelectCam}
              onToggleShare={eventHandlers.handleToggleShare}
              onToggleDnd={eventHandlers.handleToggleDnd}
              onRecenter={eventHandlers.handleRecenter}
            />
          </>
        )}

        <WorldModals
          apiBase={apiBase}
          colyseusRef={colyseusRef}
          userModalOpen={userModalOpen}
          setUserModalOpen={setUserModalOpen}
          profileOpen={profileOpen}
          setProfileOpen={setProfileOpen}
          billingOpen={billingOpen}
          setBillingOpen={setBillingOpen}
          tenantSettingsOpen={tenantSettingsOpen}
          setTenantSettingsOpen={setTenantSettingsOpen}
          sessionsOpen={sessionsOpen}
          setSessionsOpen={setSessionsOpen}
          apiModalOpen={apiModalOpen}
          setApiModalOpen={setApiModalOpen}
          apiTokens={apiTokens}
          setApiTokens={setApiTokens}
          newTokenName={newTokenName}
          setNewTokenName={setNewTokenName}
          freshToken={freshToken}
          setFreshToken={setFreshToken}
          invitesModalOpen={invitesModalOpen}
          setInvitesModalOpen={setInvitesModalOpen}
        />
        {/* Desktop Preferences Modal (optional, nur wenn Desktop-Modul geladen) */}
        {desktop?.TauriPreferencesModal && (
          <desktop.TauriPreferencesModal open={tauriPrefsOpen} onOpenChange={setTauriPrefsOpen} />
        )}
      </div>

      <RosterPanel
        roster={roster}
        collapsed={rosterCollapsed}
        onToggleCollapse={eventHandlers.handleToggleRosterCollapse}
        onJumpTo={eventHandlers.handleJumpTo}
      />

      <EditorWindow
        onSave={saveAllToServer}
        onClose={() => {
          if (EditorService.hasPendingChanges()) {
            gameBridge.restoreEditorSnapshot();
          }
          EditorService.dispatch({ type: 'DEACTIVATE_EDITOR' });
        }}
      />

      <BubbleBanner
        active={bubbleUi.active}
        members={bubbleUi.members}
        onLeave={eventHandlers.handleBubbleLeave}
      />

      <WorldContextMenu
        contextMenu={contextMenu}
        onClose={eventHandlers.handleCloseContextMenu}
        localPosRef={localPosRef}
        bubbleGroupsRef={bubbleGroupsRef}
        followRef={followRef}
        gameBridge={gameBridge}
        colyseusRef={colyseusRef}
        bubbleStartRef={bubbleStartRef}
      />
    </div>
    </>
  );
}
