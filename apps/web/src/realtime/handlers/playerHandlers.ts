import type { UseWorldRoomArgs } from '../types';
import { useMapStore } from '../../state/mapStore';
import { emitSameMapIdentities } from '../../lib/avEvents';

export interface SetupPlayerHandlersOptions {
  /** Called once when the server's initial 'full_state' message arrives for this session. */
  onFullStateReceived?: () => void;
}

export function setupPlayerHandlers(
  room: any,
  args: UseWorldRoomArgs,
  scheduleBuildParticipantList: (delay: number) => void,
  scheduleRefreshRosterFromRemotes: (delay: number) => void,
  options?: SetupPlayerHandlersOptions
) {
  const {
    localPosRef,
    remotesRef,
    colyseusToLivekitMap,
    identityToNameMap,
    gameBridge,
    applyVolumesToUi,
    editor,
    colyseusRef,
  } = args;

  /** Emit the set of LiveKit identities for players on the same map */
  const emitCurrentMapIdentities = () => {
    const ids: string[] = [];
    // Add own identity
    const selfId = localPosRef.current.id;
    if (selfId && colyseusToLivekitMap.current[selfId]) {
      ids.push(colyseusToLivekitMap.current[selfId]);
    }
    // Add same-map remote identities
    for (const colyseusId of Object.keys(remotesRef.current)) {
      const livekitIdentity = colyseusToLivekitMap.current[colyseusId];
      if (livekitIdentity) ids.push(livekitIdentity);
    }
    emitSameMapIdentities(ids);
  };

  // Full state sync
  room.onMessage('full_state', (data: any) => {
    // Signal to consumers (e.g. reconnect gate) that initial state has arrived.
    try { options?.onFullStateReceived?.(); } catch {}
    if (!gameBridge?.syncRemotePlayers) return;
    if (data?.players) {
      // Sync local player's mapId/mapName from server (most reliable source)
      const localPlayer = data.players?.find((p: any) => p.id === localPosRef.current.id);
      if (localPlayer?.mapId) {
        const mapState = useMapStore.getState();
        if (!mapState.currentMapId || mapState.currentMapId !== localPlayer.mapId) {
          useMapStore.getState().setCurrentMap(localPlayer.mapId, localPlayer.mapName || '');
        }
      }
      const currentMap = useMapStore.getState().currentMapName;
      const players: Record<string, { x: number; y: number; direction: any; name?: string; dnd?: boolean; avatarId?: string; isNpc?: boolean }> = {};
      for (const p of data.players) {
        if (p.id === localPosRef.current.id) continue;
        // Only render players on the same map
        if (p.mapName && p.mapName !== currentMap) continue;
        if (p.identity) {
          colyseusToLivekitMap.current[p.id] = p.identity;
          if (p.name) identityToNameMap.current[p.identity] = p.name;
        }
        players[p.id] = { x: p.x, y: p.y, direction: p.direction, name: p.name, dnd: p.dnd, avatarId: p.avatarId, isNpc: p.isNpc } as any;
      }
      if (gameBridge && typeof gameBridge.syncRemotePlayers === 'function') gameBridge.syncRemotePlayers(players);
      remotesRef.current = Object.fromEntries(Object.entries(players).map(([id, p]) => [id, { x: (p as any).x, y: (p as any).y, dnd: (p as any).dnd, avatarId: (p as any).avatarId }]));
      scheduleBuildParticipantList(0);
      emitCurrentMapIdentities();
      // Roster unmittelbar aus Remotes aktualisieren
      scheduleRefreshRosterFromRemotes(0);
    }
  });

  // Player joined
  room.onMessage('player_joined', (data: any) => {
    if (data.id === localPosRef.current.id) return;
    const currentMap = useMapStore.getState().currentMapName;
    if (data.mapName && data.mapName !== currentMap) return;
    remotesRef.current[data.id] = { x: data.x, y: data.y, dnd: data.dnd, avatarId: data.avatarId };
    if (data.identity) {
      colyseusToLivekitMap.current[data.id] = data.identity;
      if (data.name) identityToNameMap.current[data.identity] = data.name;
    }
    if (gameBridge && typeof (gameBridge as any).addRemotePlayer === 'function') (gameBridge as any).addRemotePlayer(data.id, { x: data.x, y: data.y, direction: data.direction, name: data.name, dnd: data.dnd, avatarId: data.avatarId, isNpc: data.isNpc });
    scheduleBuildParticipantList(50);
    emitCurrentMapIdentities();
    scheduleRefreshRosterFromRemotes(0);
    applyVolumesToUi();
    try {
      const currZones = (editor?.zones || []);
      if (Array.isArray(currZones) && currZones.length > 0) {
        colyseusRef.current?.send?.('editor_update', { type: 'zone', polys: currZones });
      }
    } catch {}
  });

  // Player moved
  room.onMessage('player_moved', (data: any) => {
    if (data.id === localPosRef.current.id) return;
    const currentMap = useMapStore.getState().currentMapName;
    if (data.mapName && data.mapName !== currentMap) return;
    // keep existing dnd state
    const prev = remotesRef.current[data.id] || {};
    remotesRef.current[data.id] = { ...prev, x: data.x, y: data.y };
    if (gameBridge && typeof gameBridge.updateRemotePlayer === 'function') gameBridge.updateRemotePlayer(data.id, { x: data.x, y: data.y, direction: data.direction });
    scheduleBuildParticipantList(50);
    scheduleRefreshRosterFromRemotes(0);
    applyVolumesToUi();
  });

  // Player left
  room.onMessage('player_left', (data: any) => {
    // Idempotent: skip if we don't track this player (already removed or never on our map)
    if (!remotesRef.current[data.id]) return;
    delete remotesRef.current[data.id];
    if (colyseusToLivekitMap.current[data.id]) {
      delete colyseusToLivekitMap.current[data.id];
    }
    if (gameBridge && typeof gameBridge.removeRemotePlayer === 'function') gameBridge.removeRemotePlayer(data.id);
    scheduleBuildParticipantList(50);
    emitCurrentMapIdentities();
    scheduleRefreshRosterFromRemotes(0);
    applyVolumesToUi();
  });

  // Player DND status
  room.onMessage('player_dnd', (data: { id: string; dnd: boolean }) => {
    if (remotesRef.current[data.id]) {
      remotesRef.current[data.id].dnd = data.dnd;
    }
    if (gameBridge && typeof (gameBridge as any).updateRemotePlayerDnd === 'function') (gameBridge as any).updateRemotePlayerDnd(data.id, data.dnd);
    scheduleBuildParticipantList(50);
  });

  // Player avatar change
  room.onMessage('player_avatar', (data: { id: string; avatarId: string }) => {
    if (data.id === localPosRef.current.id) return;
    // Update remotesRef so UI cards show the new avatar
    if (remotesRef.current[data.id]) {
      remotesRef.current[data.id].avatarId = data.avatarId;
    }
    if (gameBridge && typeof gameBridge.updateRemotePlayer === 'function') {
      gameBridge.updateRemotePlayer(data.id, { avatarId: data.avatarId });
    }
    scheduleBuildParticipantList(50);
  });

  // Player map changed
  room.onMessage('player_map_changed', (data: { id: string; oldMapName: string; newMapName: string; x: number; y: number; name?: string; identity?: string; avatarId?: string; dnd?: boolean; isNpc?: boolean }) => {
    const currentMap = useMapStore.getState().currentMapName;

    if (data.oldMapName === currentMap) {
      // Player left our map - remove them
      delete remotesRef.current[data.id];
      delete colyseusToLivekitMap.current[data.id];
      if (gameBridge && typeof gameBridge.removeRemotePlayer === 'function') {
        gameBridge.removeRemotePlayer(data.id);
      }
      scheduleBuildParticipantList(50);
      emitCurrentMapIdentities();
      scheduleRefreshRosterFromRemotes(0);
    }

    if (data.newMapName === currentMap) {
      // Player entered our map - add them
      remotesRef.current[data.id] = { x: data.x, y: data.y, ...(data.dnd != null ? { dnd: data.dnd } : {}), ...(data.avatarId ? { avatarId: data.avatarId } : {}) };
      if (data.identity) {
        colyseusToLivekitMap.current[data.id] = data.identity;
        if (data.name) identityToNameMap.current[data.identity] = data.name;
      }
      if (gameBridge && typeof (gameBridge as any).addRemotePlayer === 'function') {
        (gameBridge as any).addRemotePlayer(data.id, {
          x: data.x, y: data.y, direction: 'down',
          name: data.name, avatarId: data.avatarId, isNpc: data.isNpc,
        });
      }
      scheduleBuildParticipantList(50);
      emitCurrentMapIdentities();
      scheduleRefreshRosterFromRemotes(0);
    }
  });

  // State change (full state sync via onStateChange)
  room.onStateChange((state: any) => {
    const currentMap = useMapStore.getState().currentMapName;
    const players: Record<string, { x: number; y: number; direction: any; dnd?: boolean; identity?: string; name?: string; avatarId?: string; isNpc?: boolean }> = {};
    if (state.players) {
      if (typeof state.players.forEach === 'function') {
        state.players.forEach((value: any, key: string) => {
          // Always update name/identity maps for roster (even for players on other maps)
          if (value.identity) {
            colyseusToLivekitMap.current[key] = value.identity;
            if (value.name) identityToNameMap.current[value.identity] = value.name;
          }
          // Only include players on the same map
          if (value.mapName && value.mapName !== currentMap) return;
          players[key] = { x: value.x, y: value.y, direction: value.direction, dnd: value.dnd, identity: value.identity, name: value.name, avatarId: value.avatarId, isNpc: value.isNpc };
        });
      } else if (typeof state.players.entries === 'function') {
        for (const [key, value] of state.players.entries()) {
          if (value.identity) {
            colyseusToLivekitMap.current[key] = value.identity;
            if (value.name) identityToNameMap.current[value.identity] = value.name;
          }
          if (value.mapName && value.mapName !== currentMap) continue;
          players[key] = { x: value.x, y: value.y, direction: value.direction, dnd: value.dnd, identity: value.identity, name: value.name, avatarId: value.avatarId, isNpc: value.isNpc };
        }
      } else if ((state.players as any)[Symbol.iterator]) {
        for (const [key, value] of (state.players as any)) {
          if (value.identity) {
            colyseusToLivekitMap.current[key] = value.identity;
            if (value.name) identityToNameMap.current[value.identity] = value.name;
          }
          if (value.mapName && value.mapName !== currentMap) continue;
          players[key] = { x: value.x, y: value.y, direction: value.direction, dnd: value.dnd, identity: value.identity, name: value.name, avatarId: value.avatarId, isNpc: value.isNpc };
        }
      }
    }
    remotesRef.current = Object.fromEntries(Object.entries(players).filter(([id]) => id !== localPosRef.current.id).map(([id, p]) => [id, { x: (p as any).x, y: (p as any).y, dnd: (p as any).dnd, avatarId: (p as any).avatarId }]));
    const filtered = Object.fromEntries(Object.entries(players).filter(([id]) => id !== localPosRef.current.id).map(([id, p]) => {
      const livekitIdentity = (p as any).identity || colyseusToLivekitMap.current[id] || id;
      const name = identityToNameMap.current[livekitIdentity] || (p as any).name || livekitIdentity;
      return [id, { ...p, name, identity: livekitIdentity }];
    }));
    if (gameBridge && typeof gameBridge.syncRemotePlayers === 'function') gameBridge.syncRemotePlayers(filtered);
    emitCurrentMapIdentities();
  });
}
