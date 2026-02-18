import type { UseWorldRoomArgs } from '../types';
import { useMapStore } from '../../state/mapStore';

export function setupPlayerHandlers(
  room: any,
  args: UseWorldRoomArgs,
  scheduleBuildParticipantList: (delay: number) => void,
  scheduleRefreshRosterFromRemotes: (delay: number) => void
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

  // Full state sync
  room.onMessage('full_state', (data: any) => {
    if (!gameBridge?.syncRemotePlayers) return;
    if (data?.players) {
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
      remotesRef.current = Object.fromEntries(Object.entries(players).map(([id, p]) => [id, { x: (p as any).x, y: (p as any).y, dnd: (p as any).dnd }]));
      scheduleBuildParticipantList(0);
      // Roster unmittelbar aus Remotes aktualisieren
      scheduleRefreshRosterFromRemotes(0);
    }
  });

  // Player joined
  room.onMessage('player_joined', (data: any) => {
    if (data.id === localPosRef.current.id) return;
    const currentMap = useMapStore.getState().currentMapName;
    if (data.mapName && data.mapName !== currentMap) return;
    remotesRef.current[data.id] = { x: data.x, y: data.y, dnd: data.dnd };
    if (data.identity) {
      colyseusToLivekitMap.current[data.id] = data.identity;
      if (data.name) identityToNameMap.current[data.identity] = data.name;
    }
    if (gameBridge && typeof (gameBridge as any).addRemotePlayer === 'function') (gameBridge as any).addRemotePlayer(data.id, { x: data.x, y: data.y, direction: data.direction, name: data.name, dnd: data.dnd, avatarId: data.avatarId, isNpc: data.isNpc });
    scheduleBuildParticipantList(50);
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
    delete remotesRef.current[data.id];
    delete colyseusToLivekitMap.current[data.id];
    if (gameBridge && typeof gameBridge.removeRemotePlayer === 'function') gameBridge.removeRemotePlayer(data.id);
    scheduleBuildParticipantList(50);
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
    if (gameBridge && typeof gameBridge.updateRemotePlayer === 'function') {
      gameBridge.updateRemotePlayer(data.id, { avatarId: data.avatarId });
    }
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
      scheduleRefreshRosterFromRemotes(0);
    }

    if (data.newMapName === currentMap) {
      // Player entered our map - add them
      remotesRef.current[data.id] = { x: data.x, y: data.y, ...(data.dnd != null ? { dnd: data.dnd } : {}) };
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
    remotesRef.current = Object.fromEntries(Object.entries(players).filter(([id]) => id !== localPosRef.current.id).map(([id, p]) => [id, { x: (p as any).x, y: (p as any).y, dnd: (p as any).dnd }]));
    const filtered = Object.fromEntries(Object.entries(players).filter(([id]) => id !== localPosRef.current.id).map(([id, p]) => {
      const livekitIdentity = (p as any).identity || colyseusToLivekitMap.current[id] || id;
      const name = identityToNameMap.current[livekitIdentity] || (p as any).name || livekitIdentity;
      return [id, { ...p, name, identity: livekitIdentity }];
    }));
    if (gameBridge && typeof gameBridge.syncRemotePlayers === 'function') gameBridge.syncRemotePlayers(filtered);
  });
}
