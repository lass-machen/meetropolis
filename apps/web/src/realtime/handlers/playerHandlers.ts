import type { UseWorldRoomArgs, PlayerData } from '../types';

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
      const players: Record<string, { x: number; y: number; direction: any; name?: string; dnd?: boolean }> = {};
      for (const p of data.players) {
        if (p.id === localPosRef.current.id) continue;
        if (p.identity) {
          colyseusToLivekitMap.current[p.id] = p.identity;
          if (p.name) identityToNameMap.current[p.identity] = p.name;
        }
        players[p.id] = { x: p.x, y: p.y, direction: p.direction, name: p.name, dnd: p.dnd } as any;
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
    remotesRef.current[data.id] = { x: data.x, y: data.y, dnd: data.dnd };
    if (data.identity) {
      colyseusToLivekitMap.current[data.id] = data.identity;
      if (data.name) identityToNameMap.current[data.identity] = data.name;
    }
    if (gameBridge && typeof (gameBridge as any).addRemotePlayer === 'function') (gameBridge as any).addRemotePlayer(data.id, { x: data.x, y: data.y, direction: data.direction, name: data.name, dnd: data.dnd });
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

  // State change (full state sync via onStateChange)
  room.onStateChange((state: any) => {
    const players: Record<string, { x: number; y: number; direction: any; dnd?: boolean; identity?: string; name?: string }> = {};
    if (state.players) {
      if (typeof state.players.forEach === 'function') {
        state.players.forEach((value: any, key: string) => {
          players[key] = { x: value.x, y: value.y, direction: value.direction, dnd: value.dnd, identity: value.identity, name: value.name };
          if (value.identity && value.name) identityToNameMap.current[value.identity] = value.name;
        });
      } else if (typeof state.players.entries === 'function') {
        for (const [key, value] of state.players.entries()) {
          players[key] = { x: value.x, y: value.y, direction: value.direction, dnd: value.dnd, identity: value.identity, name: value.name };
          if (value.identity && value.name) identityToNameMap.current[value.identity] = value.name;
        }
      } else if ((state.players as any)[Symbol.iterator]) {
        for (const [key, value] of (state.players as any)) {
          players[key] = { x: value.x, y: value.y, direction: value.direction, dnd: value.dnd, identity: value.identity, name: value.name };
          if (value.identity && value.name) identityToNameMap.current[value.identity] = value.name;
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
