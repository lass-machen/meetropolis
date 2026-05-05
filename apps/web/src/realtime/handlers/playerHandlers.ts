import type { UseWorldRoomArgs } from '../types';
import { useMapStore } from '../../state/mapStore';
import { emitSameMapIdentities } from '../../lib/avEvents';
import { passesMapFilter } from './mapFilter';

export interface SetupPlayerHandlersOptions {
  /** Called once when the server's initial 'full_state' message arrives for this session. */
  onFullStateReceived?: () => void;
}

interface HandlerCtx {
  args: UseWorldRoomArgs;
  scheduleBuildParticipantList: (delay: number) => void;
  scheduleRefreshRosterFromRemotes: (delay: number) => void;
  emitCurrentMapIdentities: () => void;
}

/** Emit the set of LiveKit identities for players on the same map. */
function makeEmitMapIdentities(args: UseWorldRoomArgs): () => void {
  const { localPosRef, remotesRef, colyseusToLivekitMap } = args;
  return () => {
    const ids: string[] = [];
    const selfId = localPosRef.current.id;
    if (selfId && colyseusToLivekitMap.current[selfId]) {
      ids.push(colyseusToLivekitMap.current[selfId]);
    }
    for (const colyseusId of Object.keys(remotesRef.current)) {
      const livekitIdentity = colyseusToLivekitMap.current[colyseusId];
      if (livekitIdentity) ids.push(livekitIdentity);
    }
    emitSameMapIdentities(ids);
  };
}

function syncLocalMapFromServer(localPlayer: { mapId?: string; mapName?: string } | undefined): void {
  if (!localPlayer?.mapId || !localPlayer.mapName) return;
  const mapState = useMapStore.getState();
  if (!mapState.currentMapId || mapState.currentMapId !== localPlayer.mapId) {
    mapState.setCurrentMap(localPlayer.mapId, localPlayer.mapName);
  }
}

function handleFullState(ctx: HandlerCtx, options: SetupPlayerHandlersOptions | undefined, data: any): void {
  try { options?.onFullStateReceived?.(); } catch {}
  const { args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes, emitCurrentMapIdentities } = ctx;
  const { localPosRef, remotesRef, colyseusToLivekitMap, identityToNameMap, gameBridge } = args;
  if (!gameBridge?.syncRemotePlayers || !data?.players) return;

  const localPlayer = data.players.find((p: any) => p.id === localPosRef.current.id);
  syncLocalMapFromServer(localPlayer);

  const currentMap = useMapStore.getState().currentMapName;
  const players: Record<string, { x: number; y: number; direction: any; name?: string; dnd?: boolean; avatarId?: string; isNpc?: boolean }> = {};
  for (const p of data.players) {
    if (p.id === localPosRef.current.id) continue;
    if (!passesMapFilter(p.mapName, currentMap)) continue;
    if (p.identity) {
      colyseusToLivekitMap.current[p.id] = p.identity;
      if (p.name) identityToNameMap.current[p.identity] = p.name;
    }
    players[p.id] = { x: p.x, y: p.y, direction: p.direction, name: p.name, dnd: p.dnd, avatarId: p.avatarId, isNpc: p.isNpc } as any;
  }
  if (typeof gameBridge.syncRemotePlayers === 'function') gameBridge.syncRemotePlayers(players);
  remotesRef.current = Object.fromEntries(Object.entries(players).map(([id, p]) => [id, { x: (p as any).x, y: (p as any).y, dnd: (p as any).dnd, avatarId: (p as any).avatarId }]));
  scheduleBuildParticipantList(0);
  emitCurrentMapIdentities();
  scheduleRefreshRosterFromRemotes(0);
}

function handlePlayerJoined(ctx: HandlerCtx, data: any): void {
  const { args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes, emitCurrentMapIdentities } = ctx;
  const { localPosRef, remotesRef, colyseusToLivekitMap, identityToNameMap, gameBridge, applyVolumesToUi, editor, colyseusRef } = args;
  if (data.id === localPosRef.current.id) return;
  const currentMap = useMapStore.getState().currentMapName;
  if (!passesMapFilter(data.mapName, currentMap)) return;
  remotesRef.current[data.id] = { x: data.x, y: data.y, dnd: data.dnd, avatarId: data.avatarId };
  if (data.identity) {
    colyseusToLivekitMap.current[data.id] = data.identity;
    if (data.name) identityToNameMap.current[data.identity] = data.name;
  }
  if (gameBridge && typeof (gameBridge as any).addRemotePlayer === 'function') {
    (gameBridge as any).addRemotePlayer(data.id, { x: data.x, y: data.y, direction: data.direction, name: data.name, dnd: data.dnd, avatarId: data.avatarId, isNpc: data.isNpc });
  }
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
}

function handlePlayerMoved(ctx: HandlerCtx, data: any): void {
  const { args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes } = ctx;
  const { localPosRef, remotesRef, gameBridge, applyVolumesToUi } = args;
  if (data.id === localPosRef.current.id) return;
  const currentMap = useMapStore.getState().currentMapName;
  if (!passesMapFilter(data.mapName, currentMap)) return;
  const prev = remotesRef.current[data.id] || {};
  remotesRef.current[data.id] = { ...prev, x: data.x, y: data.y };
  if (gameBridge && typeof gameBridge.updateRemotePlayer === 'function') gameBridge.updateRemotePlayer(data.id, { x: data.x, y: data.y, direction: data.direction });
  scheduleBuildParticipantList(50);
  scheduleRefreshRosterFromRemotes(0);
  applyVolumesToUi();
}

function handlePlayerLeft(ctx: HandlerCtx, data: any): void {
  const { args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes, emitCurrentMapIdentities } = ctx;
  const { remotesRef, colyseusToLivekitMap, gameBridge, applyVolumesToUi } = args;
  if (!remotesRef.current[data.id]) return;
  delete remotesRef.current[data.id];
  if (colyseusToLivekitMap.current[data.id]) delete colyseusToLivekitMap.current[data.id];
  if (gameBridge && typeof gameBridge.removeRemotePlayer === 'function') gameBridge.removeRemotePlayer(data.id);
  scheduleBuildParticipantList(50);
  emitCurrentMapIdentities();
  scheduleRefreshRosterFromRemotes(0);
  applyVolumesToUi();
}

function handlePlayerDnd(ctx: HandlerCtx, data: { id: string; dnd: boolean }): void {
  const { args, scheduleBuildParticipantList } = ctx;
  const { remotesRef, gameBridge } = args;
  if (remotesRef.current[data.id]) remotesRef.current[data.id].dnd = data.dnd;
  if (gameBridge && typeof (gameBridge as any).updateRemotePlayerDnd === 'function') (gameBridge as any).updateRemotePlayerDnd(data.id, data.dnd);
  scheduleBuildParticipantList(50);
}

function handlePlayerAvatar(ctx: HandlerCtx, data: { id: string; avatarId: string }): void {
  const { args, scheduleBuildParticipantList } = ctx;
  const { localPosRef, remotesRef, gameBridge } = args;
  if (data.id === localPosRef.current.id) return;
  if (remotesRef.current[data.id]) remotesRef.current[data.id].avatarId = data.avatarId;
  if (gameBridge && typeof gameBridge.updateRemotePlayer === 'function') {
    gameBridge.updateRemotePlayer(data.id, { avatarId: data.avatarId });
  }
  scheduleBuildParticipantList(50);
}

function handlePlayerMapChanged(ctx: HandlerCtx, data: { id: string; oldMapName: string; newMapName: string; x: number; y: number; name?: string; identity?: string; avatarId?: string; dnd?: boolean; isNpc?: boolean }): void {
  const { args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes, emitCurrentMapIdentities } = ctx;
  const { remotesRef, colyseusToLivekitMap, identityToNameMap, gameBridge } = args;
  const currentMap = useMapStore.getState().currentMapName;

  if (data.oldMapName === currentMap) {
    delete remotesRef.current[data.id];
    delete colyseusToLivekitMap.current[data.id];
    if (gameBridge && typeof gameBridge.removeRemotePlayer === 'function') gameBridge.removeRemotePlayer(data.id);
    scheduleBuildParticipantList(50);
    emitCurrentMapIdentities();
    scheduleRefreshRosterFromRemotes(0);
  }

  if (data.newMapName === currentMap) {
    remotesRef.current[data.id] = { x: data.x, y: data.y, ...(data.dnd != null ? { dnd: data.dnd } : {}), ...(data.avatarId ? { avatarId: data.avatarId } : {}) };
    if (data.identity) {
      colyseusToLivekitMap.current[data.id] = data.identity;
      if (data.name) identityToNameMap.current[data.identity] = data.name;
    }
    if (gameBridge && typeof (gameBridge as any).addRemotePlayer === 'function') {
      (gameBridge as any).addRemotePlayer(data.id, { x: data.x, y: data.y, direction: 'down', name: data.name, avatarId: data.avatarId, isNpc: data.isNpc });
    }
    scheduleBuildParticipantList(50);
    emitCurrentMapIdentities();
    scheduleRefreshRosterFromRemotes(0);
  }
}

function iteratePlayersFromState(state: any, collect: (value: any, key: string) => void): void {
  if (!state.players) return;
  if (typeof state.players.forEach === 'function') {
    state.players.forEach((value: any, key: string) => collect(value, key));
  } else if (typeof state.players.entries === 'function') {
    for (const [key, value] of state.players.entries()) collect(value, key);
  } else if ((state.players as any)[Symbol.iterator]) {
    for (const [key, value] of (state.players as any)) collect(value, key);
  }
}

function handleStateChange(ctx: HandlerCtx, state: any): void {
  const { args, emitCurrentMapIdentities } = ctx;
  const { localPosRef, remotesRef, colyseusToLivekitMap, identityToNameMap, gameBridge } = args;
  try {
    const localId = localPosRef.current.id;
    if (localId && state.players) {
      const local = typeof state.players.get === 'function' ? state.players.get(localId) : undefined;
      syncLocalMapFromServer(local);
    }
  } catch {}
  const currentMap = useMapStore.getState().currentMapName;
  const players: Record<string, { x: number; y: number; direction: any; dnd?: boolean; identity?: string; name?: string; avatarId?: string; isNpc?: boolean }> = {};
  iteratePlayersFromState(state, (value, key) => {
    if (value.identity) {
      colyseusToLivekitMap.current[key] = value.identity;
      if (value.name) identityToNameMap.current[value.identity] = value.name;
    }
    if (!passesMapFilter(value.mapName, currentMap)) return;
    players[key] = { x: value.x, y: value.y, direction: value.direction, dnd: value.dnd, identity: value.identity, name: value.name, avatarId: value.avatarId, isNpc: value.isNpc };
  });
  remotesRef.current = Object.fromEntries(Object.entries(players).filter(([id]) => id !== localPosRef.current.id).map(([id, p]) => [id, { x: (p as any).x, y: (p as any).y, dnd: (p as any).dnd, avatarId: (p as any).avatarId }]));
  const filtered = Object.fromEntries(Object.entries(players).filter(([id]) => id !== localPosRef.current.id).map(([id, p]) => {
    const livekitIdentity = (p as any).identity || colyseusToLivekitMap.current[id] || id;
    const name = identityToNameMap.current[livekitIdentity] || (p as any).name || livekitIdentity;
    return [id, { ...p, name, identity: livekitIdentity }];
  }));
  if (gameBridge && typeof gameBridge.syncRemotePlayers === 'function') gameBridge.syncRemotePlayers(filtered);
  emitCurrentMapIdentities();
}

export function setupPlayerHandlers(
  room: any,
  args: UseWorldRoomArgs,
  scheduleBuildParticipantList: (delay: number) => void,
  scheduleRefreshRosterFromRemotes: (delay: number) => void,
  options?: SetupPlayerHandlersOptions
) {
  const ctx: HandlerCtx = {
    args,
    scheduleBuildParticipantList,
    scheduleRefreshRosterFromRemotes,
    emitCurrentMapIdentities: makeEmitMapIdentities(args),
  };
  room.onMessage('full_state', (data: any) => handleFullState(ctx, options, data));
  room.onMessage('player_joined', (data: any) => handlePlayerJoined(ctx, data));
  room.onMessage('player_moved', (data: any) => handlePlayerMoved(ctx, data));
  room.onMessage('player_left', (data: any) => handlePlayerLeft(ctx, data));
  room.onMessage('player_dnd', (data: { id: string; dnd: boolean }) => handlePlayerDnd(ctx, data));
  room.onMessage('player_avatar', (data: { id: string; avatarId: string }) => handlePlayerAvatar(ctx, data));
  room.onMessage('player_map_changed', (data: any) => handlePlayerMapChanged(ctx, data));
  room.onStateChange((state: any) => handleStateChange(ctx, state));
}
