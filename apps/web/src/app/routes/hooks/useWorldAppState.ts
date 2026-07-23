import React from 'react';
import type { AVManager } from '../../../av/avManager';
import type { BubbleManager } from '../../../game/bubbleManager';
import type { FollowManager } from '../../../game/followManager';
import type { ZoneManager } from '../../../game/zoneManager';
import type { VolumeManager } from '../../../game/volumeManager';
import type { WorldRoom } from '../../../types/colyseus';
import type { AdminCapabilities } from './useFetchMe';

export type WorldMe = {
  id: string;
  email: string;
  name?: string;
  onboardingCompleted?: boolean;
  role?: string;
  /** From /auth/me. Drives the soft verification reminder; never a gate. */
  emailVerified?: boolean;
} | null;

// micPending: the mic is desired but the actual publication is still catching
// up (a hybrid-mute republish after the capture was released). Drives the mic
// button's "reconnecting" pulse. Optional so existing setState callers that only
// touch mic/cam/share/dnd stay valid.
export type AvStateShape = { mic: boolean; cam: boolean; share: boolean; dnd: boolean; micPending?: boolean };

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

  avState: AvStateShape;
  setAvState: React.Dispatch<React.SetStateAction<AvStateShape>>;

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

  // Transient offline state during the boot auth-check (network/5xx). Kept
  // separate from `authChecked` so a brief outage shows an offline hint instead
  // of a login redirect.
  authOffline: boolean;
  setAuthOffline: React.Dispatch<React.SetStateAction<boolean>>;

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
  | 'authOffline'
  | 'setAuthOffline'
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
