import React, { useRef } from 'react';
import { AVManager } from '../../../av/avManager';
import { BubbleManager } from '../../../game/bubbleManager';
import { FollowManager } from '../../../game/followManager';
import { ZoneManager } from '../../../game/zoneManager';
import { VolumeManager } from '../../../game/volumeManager';
import { getDisplayName as getDisplayNameLib } from '../../../lib/displayName';
import type { WorldRoom } from '../../../types/colyseus';
import type { AdminCapabilities } from './useFetchMe';

export type WorldMe = {
  id: string;
  email: string;
  name?: string;
  onboardingCompleted?: boolean;
  role?: string;
} | null;

export type AvStateShape = { mic: boolean; cam: boolean; share: boolean; dnd: boolean };

export type DeviceListShape = {
  mics: { id: string; label: string }[];
  cams: { id: string; label: string }[];
};

export type UiParticipantShape = {
  sid: string;
  identity: string;
  hasVideo: boolean;
  hasMic: boolean;
  isSpeaking: boolean;
  media: 'camera' | 'screen';
  volume?: number;
};

export type RosterEntryShape = {
  identity: string;
  name: string;
  online: boolean;
  x?: number;
  y?: number;
  lastSeen?: string;
};

export type ApiTokenShape = {
  id: string;
  name?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
};

export type ConnStatusShape = { reconnecting: boolean; lastCode?: number; lastReason?: string };

export type BubbleUiShape = { active: boolean; members: string[] };

export type ContextMenuShape = { open: boolean; x: number; y: number; playerId: string | null };

export type HudShape = { zone?: string; follow?: string | null; avRoom?: string | null };

export interface WorldAppState {
  // Refs
  containerRef: React.RefObject<HTMLDivElement | null>;
  colyseusRef: React.RefObject<WorldRoom | null>;
  colyseusReconnectTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  avRef: React.RefObject<AVManager | null>;
  bubbleRef: React.RefObject<BubbleManager | null>;
  zoneRef: React.RefObject<ZoneManager | null>;
  followRef: React.RefObject<FollowManager | null>;
  volumeRef: React.RefObject<VolumeManager | null>;
  bubbleMembersRef: React.RefObject<Set<string>>;
  bubbleGroupsRef: React.RefObject<Record<string, string>>;
  localPosRef: React.RefObject<{ id: string; x?: number; y?: number }>;
  remotesRef: React.RefObject<Record<string, { x: number; y: number }>>;
  colyseusToLivekitMap: React.RefObject<Record<string, string>>;
  identityToNameMap: React.RefObject<Record<string, string>>;
  participantVolumesRef: React.RefObject<Record<string, number>>;
  dndRef: React.RefObject<boolean>;
  rosterByIdentityRef: React.RefObject<Record<string, { name: string; x: number; y: number }>>;
  bubblePendingRef: React.RefObject<{ targetId: string; dest?: { x: number; y: number } } | null>;
  bubbleStartRef: React.RefObject<null | ((id: string) => void)>;
  manualNavRef: React.RefObject<{ x: number; y: number } | null>;
  disposedRef: React.RefObject<boolean>;
  gameCreatedRef: React.RefObject<boolean>;
  lastSavedPositionRef: React.RefObject<{ x: number; y: number; direction: string }>;
  moveTimeoutRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  buildListTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  buildListRafRef: React.RefObject<number | null>;
  lastAutoFullscreenRef: React.RefObject<number>;
  editorActiveRef: React.RefObject<boolean>;
  activateBubbleNowRef: React.RefObject<(id: string) => void>;

  // State
  hud: { zone?: string; follow?: string | null; avRoom?: string | null };
  setHud: React.Dispatch<React.SetStateAction<{ zone?: string; follow?: string | null; avRoom?: string | null }>>;

  devices: { mics: { id: string; label: string }[]; cams: { id: string; label: string }[] };
  setDevices: React.Dispatch<
    React.SetStateAction<{ mics: { id: string; label: string }[]; cams: { id: string; label: string }[] }>
  >;

  avState: { mic: boolean; cam: boolean; share: boolean; dnd: boolean };
  setAvState: React.Dispatch<React.SetStateAction<{ mic: boolean; cam: boolean; share: boolean; dnd: boolean }>>;

  selectedMicId: string;
  setSelectedMicId: React.Dispatch<React.SetStateAction<string>>;

  selectedCamId: string;
  setSelectedCamId: React.Dispatch<React.SetStateAction<string>>;

  uiParticipants: {
    sid: string;
    identity: string;
    hasVideo: boolean;
    hasMic: boolean;
    isSpeaking: boolean;
    media: 'camera' | 'screen';
    volume?: number;
  }[];
  setUiParticipants: React.Dispatch<
    React.SetStateAction<
      {
        sid: string;
        identity: string;
        hasVideo: boolean;
        hasMic: boolean;
        isSpeaking: boolean;
        media: 'camera' | 'screen';
        volume?: number;
      }[]
    >
  >;

  cameraManual: boolean;
  setCameraManual: React.Dispatch<React.SetStateAction<boolean>>;

  userModalOpen: boolean;
  setUserModalOpen: React.Dispatch<React.SetStateAction<boolean>>;

  invitesModalOpen: boolean;
  setInvitesModalOpen: React.Dispatch<React.SetStateAction<boolean>>;

  roster: Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>;
  setRoster: React.Dispatch<
    React.SetStateAction<
      Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>
    >
  >;

  positionReady: boolean;
  setPositionReady: React.Dispatch<React.SetStateAction<boolean>>;

  apiModalOpen: boolean;
  setApiModalOpen: React.Dispatch<React.SetStateAction<boolean>>;

  apiTokens: { id: string; name?: string | null; createdAt: string; lastUsedAt?: string | null }[];
  setApiTokens: React.Dispatch<
    React.SetStateAction<{ id: string; name?: string | null; createdAt: string; lastUsedAt?: string | null }[]>
  >;

  newTokenName: string;
  setNewTokenName: React.Dispatch<React.SetStateAction<string>>;

  freshToken: string | null;
  setFreshToken: React.Dispatch<React.SetStateAction<string | null>>;

  adminOpen: boolean;
  setAdminOpen: React.Dispatch<React.SetStateAction<boolean>>;

  billingOpen: boolean;
  setBillingOpen: React.Dispatch<React.SetStateAction<boolean>>;

  profileOpen: boolean;
  setProfileOpen: React.Dispatch<React.SetStateAction<boolean>>;

  tenantSettingsOpen: boolean;
  setTenantSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;

  sessionsOpen: boolean;
  setSessionsOpen: React.Dispatch<React.SetStateAction<boolean>>;

  isInternalOwner: boolean;
  setIsInternalOwner: React.Dispatch<React.SetStateAction<boolean>>;

  gridExpanded: boolean;
  setGridExpanded: React.Dispatch<React.SetStateAction<boolean>>;

  selectedSid: string | null;
  setSelectedSid: React.Dispatch<React.SetStateAction<string | null>>;

  overlayZoom: number;
  setOverlayZoom: React.Dispatch<React.SetStateAction<number>>;

  connStatus: { reconnecting: boolean; lastCode?: number; lastReason?: string };
  setConnStatus: React.Dispatch<
    React.SetStateAction<{ reconnecting: boolean; lastCode?: number; lastReason?: string }>
  >;

  rosterCollapsed: boolean;
  setRosterCollapsed: React.Dispatch<React.SetStateAction<boolean>>;

  bubbleUi: { active: boolean; members: string[] };
  setBubbleUi: React.Dispatch<React.SetStateAction<{ active: boolean; members: string[] }>>;

  contextMenu: { open: boolean; x: number; y: number; playerId: string | null };
  setContextMenu: React.Dispatch<
    React.SetStateAction<{ open: boolean; x: number; y: number; playerId: string | null }>
  >;

  page: string;
  setPage: React.Dispatch<React.SetStateAction<string>>;

  menuOpen: boolean;
  setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;

  authChecked: boolean;
  setAuthChecked: React.Dispatch<React.SetStateAction<boolean>>;

  me: WorldMe;
  setMe: React.Dispatch<React.SetStateAction<WorldMe>>;

  // Capabilities and auth refetch trigger (used by WorldApp shell)
  capabilities: AdminCapabilities;
  setCapabilities: React.Dispatch<React.SetStateAction<AdminCapabilities>>;
  authRefetchTrigger: number;
  setAuthRefetchTrigger: React.Dispatch<React.SetStateAction<number>>;
  billingAvailable: boolean;
  setBillingAvailable: React.Dispatch<React.SetStateAction<boolean>>;

  // Additional UI panels used by WorldApp shell
  tenantTab: string;
  setTenantTab: React.Dispatch<React.SetStateAction<string>>;
  packStoreOpen: boolean;
  setPackStoreOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Helper functions
  getDisplayName: (identity: string) => string;
}

/**
 * Refs sub-shape of WorldAppState: everything that ends in `Ref` or maps.
 * Use this for composite hooks that only need ref access.
 */
export type WorldRefs = Pick<
  WorldAppState,
  | 'containerRef'
  | 'colyseusRef'
  | 'colyseusReconnectTimerRef'
  | 'avRef'
  | 'bubbleRef'
  | 'zoneRef'
  | 'followRef'
  | 'volumeRef'
  | 'bubbleMembersRef'
  | 'bubbleGroupsRef'
  | 'localPosRef'
  | 'remotesRef'
  | 'colyseusToLivekitMap'
  | 'identityToNameMap'
  | 'participantVolumesRef'
  | 'dndRef'
  | 'rosterByIdentityRef'
  | 'bubblePendingRef'
  | 'bubbleStartRef'
  | 'manualNavRef'
  | 'disposedRef'
  | 'gameCreatedRef'
  | 'lastSavedPositionRef'
  | 'moveTimeoutRef'
  | 'buildListTimerRef'
  | 'buildListRafRef'
  | 'lastAutoFullscreenRef'
  | 'editorActiveRef'
  | 'activateBubbleNowRef'
>;

/**
 * Auth sub-shape of WorldAppState used by WorldApp.tsx and composite hooks.
 */
export type WorldAuth = Pick<
  WorldAppState,
  | 'authChecked'
  | 'setAuthChecked'
  | 'me'
  | 'setMe'
  | 'isInternalOwner'
  | 'setIsInternalOwner'
  | 'capabilities'
  | 'setCapabilities'
  | 'authRefetchTrigger'
  | 'setAuthRefetchTrigger'
  | 'positionReady'
  | 'setPositionReady'
  | 'billingAvailable'
  | 'setBillingAvailable'
>;

/**
 * UI sub-shape of WorldAppState: UI panels, modals, AV state and roster.
 */
export type WorldUi = Pick<
  WorldAppState,
  | 'hud'
  | 'setHud'
  | 'devices'
  | 'setDevices'
  | 'avState'
  | 'setAvState'
  | 'selectedMicId'
  | 'setSelectedMicId'
  | 'selectedCamId'
  | 'setSelectedCamId'
  | 'uiParticipants'
  | 'setUiParticipants'
  | 'cameraManual'
  | 'setCameraManual'
  | 'tenantTab'
  | 'setTenantTab'
  | 'roster'
  | 'setRoster'
  | 'apiModalOpen'
  | 'setApiModalOpen'
  | 'apiTokens'
  | 'setApiTokens'
  | 'newTokenName'
  | 'setNewTokenName'
  | 'freshToken'
  | 'setFreshToken'
  | 'adminOpen'
  | 'setAdminOpen'
  | 'billingOpen'
  | 'setBillingOpen'
  | 'profileOpen'
  | 'setProfileOpen'
  | 'tenantSettingsOpen'
  | 'setTenantSettingsOpen'
  | 'sessionsOpen'
  | 'setSessionsOpen'
  | 'packStoreOpen'
  | 'setPackStoreOpen'
  | 'gridExpanded'
  | 'setGridExpanded'
  | 'selectedSid'
  | 'setSelectedSid'
  | 'overlayZoom'
  | 'setOverlayZoom'
  | 'connStatus'
  | 'setConnStatus'
  | 'rosterCollapsed'
  | 'setRosterCollapsed'
  | 'bubbleUi'
  | 'setBubbleUi'
  | 'contextMenu'
  | 'setContextMenu'
  | 'page'
  | 'setPage'
  | 'menuOpen'
  | 'setMenuOpen'
>;

function useWorldRefs() {
  return {
    containerRef: useRef<HTMLDivElement | null>(null),
    colyseusRef: useRef<WorldRoom | null>(null),
    colyseusReconnectTimerRef: useRef<ReturnType<typeof setTimeout> | null>(null),
    avRef: useRef<AVManager | null>(null),
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
    moveTimeoutRef: useRef<ReturnType<typeof setTimeout> | null>(null),
    buildListTimerRef: useRef<ReturnType<typeof setTimeout> | null>(null),
    buildListRafRef: useRef<number | null>(null),
    lastAutoFullscreenRef: useRef<number>(0),
    editorActiveRef: useRef(false),
    activateBubbleNowRef: useRef<(id: string) => void>(() => {}),
  };
}

function useWorldUserState() {
  const [authChecked, setAuthChecked] = React.useState(false);
  const [me, setMe] = React.useState<WorldMe>(null);
  const [isInternalOwner, setIsInternalOwner] = React.useState(false);
  const [positionReady, setPositionReady] = React.useState(false);
  const DEFAULT_CAPS: AdminCapabilities = { hasBilling: false, hasAdminEnterprise: false, isMultiTenant: false };
  const [capabilities, setCapabilities] = React.useState<AdminCapabilities>(DEFAULT_CAPS);
  const [authRefetchTrigger, setAuthRefetchTrigger] = React.useState(0);
  const [billingAvailable, setBillingAvailable] = React.useState(false);
  return {
    authChecked,
    setAuthChecked,
    me,
    setMe,
    isInternalOwner,
    setIsInternalOwner,
    positionReady,
    setPositionReady,
    capabilities,
    setCapabilities,
    authRefetchTrigger,
    setAuthRefetchTrigger,
    billingAvailable,
    setBillingAvailable,
  };
}

function useWorldAvState() {
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
  };
}

function useWorldModalState() {
  const [userModalOpen, setUserModalOpen] = React.useState(false);
  const [invitesModalOpen, setInvitesModalOpen] = React.useState(false);
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
  const [tenantTab, setTenantTab] = React.useState('general');
  return {
    userModalOpen,
    setUserModalOpen,
    invitesModalOpen,
    setInvitesModalOpen,
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
    tenantTab,
    setTenantTab,
  };
}

function useWorldUiState() {
  const [roster, setRoster] = React.useState<
    Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>
  >([]);
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
    roster,
    setRoster,
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

export function useWorldAppState(): WorldAppState {
  const refs = useWorldRefs();
  const user = useWorldUserState();
  const av = useWorldAvState();
  const modals = useWorldModalState();
  const ui = useWorldUiState();

  const getDisplayName = (identity: string): string =>
    getDisplayNameLib(identity, refs.identityToNameMap.current, user.me);

  return { ...refs, ...user, ...av, ...modals, ...ui, getDisplayName };
}
