import React from 'react';

export type AnyRef<T> = React.MutableRefObject<T>;

export interface UseWorldRoomArgs {
  apiBase: string;
  me: { id: string; email: string; name?: string } | null;
  avRef: AnyRef<any>;
  colyseusRef: AnyRef<any>;
  localPosRef: AnyRef<{ id: string; x?: number; y?: number }>;
  remotesRef: AnyRef<Record<string, { x: number; y: number; dnd?: boolean; avatarId?: string }>>;
  colyseusToLivekitMap: AnyRef<Record<string, string>>;
  identityToNameMap: AnyRef<Record<string, string>>;
  gameBridge: any;
  // editor/zone sync
  editor: any;
  setEditor: React.Dispatch<React.SetStateAction<any>>;
  zoneRef: AnyRef<any>;
  // UI & audio
  buildParticipantList: () => void;
  applyVolumesToUi: () => void;
  setBubbleUi: React.Dispatch<React.SetStateAction<{ active: boolean; members: string[] }>>;
  // bubble members (used by VolumeManager providers)
  bubbleMembersRef: AnyRef<Set<string>>;
  // bubble groups mapping: colyseusId -> groupId
  bubbleGroupsRef: AnyRef<Record<string, string>>;
  dndRef: AnyRef<boolean>;
  setAvState: React.Dispatch<React.SetStateAction<{ mic: boolean; cam: boolean; share: boolean; dnd: boolean }>>;
  // roster
  rosterByIdentityRef: AnyRef<Record<string, { name: string; x: number; y: number }>>;
  setRoster: React.Dispatch<React.SetStateAction<Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>>>;
  // lifetime
  disposedRef: AnyRef<boolean>;
  // connection monitor (optional)
  setConnectionStatus?: React.Dispatch<React.SetStateAction<{ reconnecting: boolean; lastCode?: number; lastReason?: string }>>;
}

export interface PlayerData {
  id: string;
  x: number;
  y: number;
  direction: any;
  name?: string;
  dnd?: boolean;
  identity?: string;
}

export interface ConnectionRefs {
  reconnectAttemptsRef: React.MutableRefObject<number>;
  reconnectTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  lastCloseInfoRef: React.MutableRefObject<{ code?: number; reason?: string }>;
  connectingRef: React.MutableRefObject<boolean>;
  coolDownUntilRef: React.MutableRefObject<number>;
  /**
   * Tracks whether the client has received the server's full_state message after a fresh connect.
   * Reset to false on handleLeave (before reconnect) and set to true when full_state arrives.
   * Consumers can use this to avoid flashing an empty roster during the reconnect gap.
   */
  hasReceivedFullStateRef: React.MutableRefObject<boolean>;
}

export interface SchedulerRefs {
  buildListTimer: any;
  buildListRaf: number | null;
  rosterTimer: any;
  rosterRaf: number | null;
}
