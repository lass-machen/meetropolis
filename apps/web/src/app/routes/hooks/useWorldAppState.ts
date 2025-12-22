import React, { useRef } from 'react';
import { AVManager } from '../../../av/avManager';
import { BubbleManager } from '../../../game/bubbleManager';
import { FollowManager } from '../../../game/followManager';
import { ZoneManager } from '../../../game/zoneManager';
import { VolumeManager } from '../../../game/volumeManager';
import { getDisplayName as getDisplayNameLib } from '../../../lib/displayName';

export interface WorldAppState {
  // Refs
  containerRef: React.RefObject<HTMLDivElement | null>;
  colyseusRef: React.RefObject<any>;
  colyseusReconnectTimerRef: React.RefObject<any>;
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
  moveTimeoutRef: React.RefObject<any>;
  buildListTimerRef: React.RefObject<any>;
  buildListRafRef: React.RefObject<number | null>;
  lastAutoFullscreenRef: React.RefObject<number>;
  editorActiveRef: React.RefObject<boolean>;
  autoSaveTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  prevZonesHashRef: React.RefObject<string>;
  activateBubbleNowRef: React.RefObject<(id: string) => void>;

  // State
  hud: { zone?: string; follow?: string | null; avRoom?: string | null };
  setHud: React.Dispatch<React.SetStateAction<{ zone?: string; follow?: string | null; avRoom?: string | null }>>;

  devices: { mics: { id: string; label: string }[]; cams: { id: string; label: string }[] };
  setDevices: React.Dispatch<React.SetStateAction<{ mics: { id: string; label: string }[]; cams: { id: string; label: string }[] }>>;

  avState: { mic: boolean; cam: boolean; share: boolean; dnd: boolean };
  setAvState: React.Dispatch<React.SetStateAction<{ mic: boolean; cam: boolean; share: boolean; dnd: boolean }>>;

  selectedMicId: string | '';
  setSelectedMicId: React.Dispatch<React.SetStateAction<string | ''>>;

  selectedCamId: string | '';
  setSelectedCamId: React.Dispatch<React.SetStateAction<string | ''>>;

  uiParticipants: { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen'; volume?: number }[];
  setUiParticipants: React.Dispatch<React.SetStateAction<{ sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen'; volume?: number }[]>>;

  cameraManual: boolean;
  setCameraManual: React.Dispatch<React.SetStateAction<boolean>>;

  userModalOpen: boolean;
  setUserModalOpen: React.Dispatch<React.SetStateAction<boolean>>;

  invitesModalOpen: boolean;
  setInvitesModalOpen: React.Dispatch<React.SetStateAction<boolean>>;

  roster: Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>;
  setRoster: React.Dispatch<React.SetStateAction<Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>>>;

  positionReady: boolean;
  setPositionReady: React.Dispatch<React.SetStateAction<boolean>>;

  apiModalOpen: boolean;
  setApiModalOpen: React.Dispatch<React.SetStateAction<boolean>>;

  apiTokens: { id: string; name?: string | null; createdAt: string; lastUsedAt?: string | null }[];
  setApiTokens: React.Dispatch<React.SetStateAction<{ id: string; name?: string | null; createdAt: string; lastUsedAt?: string | null }[]>>;

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
  setConnStatus: React.Dispatch<React.SetStateAction<{ reconnecting: boolean; lastCode?: number; lastReason?: string }>>;

  rosterCollapsed: boolean;
  setRosterCollapsed: React.Dispatch<React.SetStateAction<boolean>>;

  bubbleUi: { active: boolean; members: string[] };
  setBubbleUi: React.Dispatch<React.SetStateAction<{ active: boolean; members: string[] }>>;

  contextMenu: { open: boolean; x: number; y: number; playerId: string | null };
  setContextMenu: React.Dispatch<React.SetStateAction<{ open: boolean; x: number; y: number; playerId: string | null }>>;

  page: 'world' | 'admin' | string;
  setPage: React.Dispatch<React.SetStateAction<'world' | 'admin' | string>>;

  menuOpen: boolean;
  setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;

  authChecked: boolean;
  setAuthChecked: React.Dispatch<React.SetStateAction<boolean>>;

  me: { id: string; email: string; name?: string } | null;
  setMe: React.Dispatch<React.SetStateAction<{ id: string; email: string; name?: string } | null>>;

  // Helper functions
  getDisplayName: (identity: string) => string;
}

export function useWorldAppState(): WorldAppState {
  // Refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const colyseusRef = useRef<any>(null);
  const colyseusReconnectTimerRef = useRef<any>(null);
  const avRef = useRef<AVManager | null>(null);
  const bubbleRef = useRef<BubbleManager | null>(null);
  const zoneRef = useRef<ZoneManager | null>(null);
  const followRef = useRef<FollowManager | null>(null);
  const volumeRef = useRef<VolumeManager | null>(null);
  const bubbleMembersRef = useRef<Set<string>>(new Set());
  const bubbleGroupsRef = useRef<Record<string, string>>({});
  const localPosRef = useRef<{ id: string; x?: number; y?: number }>({ id: '' });
  const remotesRef = useRef<Record<string, { x: number; y: number }>>({});
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
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevZonesHashRef = useRef<string>('');
  const activateBubbleNowRef = useRef<(id: string) => void>(() => { });

  // State
  const [authChecked, setAuthChecked] = React.useState(false);
  const [me, setMe] = React.useState<{ id: string; email: string; name?: string } | null>(null);
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
  const [isInternalOwner, setIsInternalOwner] = React.useState(false);
  const [gridExpanded, setGridExpanded] = React.useState(false);
  const [selectedSid, setSelectedSid] = React.useState<string | null>(null);
  const [overlayZoom, setOverlayZoom] = React.useState(1);
  const [connStatus, setConnStatus] = React.useState<{ reconnecting: boolean; lastCode?: number; lastReason?: string }>({ reconnecting: false });
  const [rosterCollapsed, setRosterCollapsed] = React.useState(false);
  const [bubbleUi, setBubbleUi] = React.useState<{ active: boolean; members: string[] }>({ active: false, members: [] });
  const [contextMenu, setContextMenu] = React.useState<{ open: boolean; x: number; y: number; playerId: string | null }>({ open: false, x: 0, y: 0, playerId: null });
  const [page, setPage] = React.useState<'world' | 'admin' | string>('world');
  const [menuOpen, setMenuOpen] = React.useState(false);

  // Helper function
  const getDisplayName = (identity: string): string =>
    getDisplayNameLib(identity, identityToNameMap.current, me);

  return {
    containerRef,
    colyseusRef,
    colyseusReconnectTimerRef,
    avRef,
    bubbleRef,
    zoneRef,
    followRef,
    volumeRef,
    bubbleMembersRef,
    bubbleGroupsRef,
    localPosRef,
    remotesRef,
    colyseusToLivekitMap,
    identityToNameMap,
    participantVolumesRef,
    dndRef,
    rosterByIdentityRef,
    bubblePendingRef,
    bubbleStartRef,
    manualNavRef,
    disposedRef,
    gameCreatedRef,
    lastSavedPositionRef,
    moveTimeoutRef,
    buildListTimerRef,
    buildListRafRef,
    lastAutoFullscreenRef,
    editorActiveRef,
    autoSaveTimerRef,
    prevZonesHashRef,
    activateBubbleNowRef,
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
    userModalOpen,
    setUserModalOpen,
    invitesModalOpen,
    setInvitesModalOpen,
    roster,
    setRoster,
    positionReady,
    setPositionReady,
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
    isInternalOwner,
    setIsInternalOwner,
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
    authChecked,
    setAuthChecked,
    me,
    setMe,
    getDisplayName,
  };
}
