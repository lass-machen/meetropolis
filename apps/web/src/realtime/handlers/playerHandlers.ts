import type { UseWorldRoomArgs } from '../types';
import { useMapStore } from '../../state/mapStore';
import { emitSameMapIdentities } from '../../lib/avEvents';
import { passesMapFilter } from './mapFilter';
import type {
  FullStateMessage,
  PlayerAvatarMessage,
  PlayerDndMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  PlayerMapChangedMessage,
  PlayerMovedMessage,
  PlayerSchema,
  PlayerStateData,
  WorldRoom,
  WorldRoomState,
} from '../../types/colyseus';
import type { PlayerDirection, RemotePlayerData } from '../../types/game';

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

// Local-only player snapshot used to feed gameBridge / remotesRef.
// The server-side schema declares `direction: string` (PlayerSchema), but the
// only valid values are PlayerDirection literals; values are cast at the
// boundary via `asPlayerDirection`.
interface RemotePlayerSnapshot {
  x: number;
  y: number;
  direction: PlayerDirection;
  name?: string;
  dnd?: boolean;
  identity?: string;
  avatarId?: string;
  isNpc?: boolean;
}

const VALID_DIRECTIONS: ReadonlySet<PlayerDirection> = new Set(['up', 'down', 'left', 'right']);

/** Coerces a string direction from the server schema to PlayerDirection. */
function asPlayerDirection(value: string | undefined): PlayerDirection {
  return value && VALID_DIRECTIONS.has(value as PlayerDirection) ? (value as PlayerDirection) : 'down';
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

// Build a minimal entry for remotesRef from a snapshot. Respects
// exactOptionalPropertyTypes by omitting undefined fields.
function toRemotesEntry(p: { x: number; y: number; dnd?: boolean; avatarId?: string }): {
  x: number;
  y: number;
  dnd?: boolean;
  avatarId?: string;
} {
  const entry: { x: number; y: number; dnd?: boolean; avatarId?: string } = { x: p.x, y: p.y };
  if (p.dnd !== undefined) entry.dnd = p.dnd;
  if (p.avatarId !== undefined) entry.avatarId = p.avatarId;
  return entry;
}

function handleFullState(
  ctx: HandlerCtx,
  options: SetupPlayerHandlersOptions | undefined,
  data: FullStateMessage,
): void {
  try {
    options?.onFullStateReceived?.();
  } catch {}
  const { args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes, emitCurrentMapIdentities } = ctx;
  const { localPosRef, remotesRef, colyseusToLivekitMap, identityToNameMap, gameBridge } = args;
  if (!gameBridge?.syncRemotePlayers || !data?.players) return;

  const localPlayer = data.players.find((p: PlayerStateData) => p.id === localPosRef.current.id);
  syncLocalMapFromServer(localPlayer);

  const currentMap = useMapStore.getState().currentMapName;
  const players: Record<string, RemotePlayerSnapshot> = {};
  for (const p of data.players) {
    if (p.id === localPosRef.current.id) continue;
    if (!passesMapFilter(p.mapName, currentMap)) continue;
    if (p.identity) {
      colyseusToLivekitMap.current[p.id] = p.identity;
      if (p.name) identityToNameMap.current[p.identity] = p.name;
    }
    const snapshot: RemotePlayerSnapshot = {
      x: p.x,
      y: p.y,
      direction: asPlayerDirection(p.direction),
    };
    if (p.name !== undefined) snapshot.name = p.name;
    if (p.dnd !== undefined) snapshot.dnd = p.dnd;
    if (p.avatarId !== undefined) snapshot.avatarId = p.avatarId;
    if (p.isNpc !== undefined) snapshot.isNpc = p.isNpc;
    players[p.id] = snapshot;
  }
  if (typeof gameBridge.syncRemotePlayers === 'function') gameBridge.syncRemotePlayers(players);
  remotesRef.current = Object.fromEntries(Object.entries(players).map(([id, p]) => [id, toRemotesEntry(p)]));
  scheduleBuildParticipantList(0);
  emitCurrentMapIdentities();
  scheduleRefreshRosterFromRemotes(0);
}

function handlePlayerJoined(ctx: HandlerCtx, data: PlayerJoinedMessage): void {
  const { args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes, emitCurrentMapIdentities } = ctx;
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
  if (data.id === localPosRef.current.id) return;
  const currentMap = useMapStore.getState().currentMapName;
  if (!passesMapFilter(data.mapName, currentMap)) return;
  const joinEntry: { x: number; y: number; dnd?: boolean; avatarId?: string } = { x: data.x, y: data.y };
  if (data.dnd !== undefined) joinEntry.dnd = data.dnd;
  if (data.avatarId !== undefined) joinEntry.avatarId = data.avatarId;
  remotesRef.current[data.id] = toRemotesEntry(joinEntry);
  if (data.identity) {
    colyseusToLivekitMap.current[data.id] = data.identity;
    if (data.name) identityToNameMap.current[data.identity] = data.name;
  }
  if (gameBridge && typeof gameBridge.addRemotePlayer === 'function') {
    gameBridge.addRemotePlayer(data.id, {
      x: data.x,
      y: data.y,
      direction: data.direction,
      name: data.name,
      dnd: data.dnd,
      avatarId: data.avatarId,
      isNpc: data.isNpc,
    });
  }
  scheduleBuildParticipantList(50);
  emitCurrentMapIdentities();
  scheduleRefreshRosterFromRemotes(0);
  applyVolumesToUi();
  try {
    const currZones = editor?.zones || [];
    if (Array.isArray(currZones) && currZones.length > 0) {
      colyseusRef.current?.send?.('editor_update', { type: 'zone', polys: currZones });
    }
  } catch {}
}

function handlePlayerMoved(ctx: HandlerCtx, data: PlayerMovedMessage): void {
  const { args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes } = ctx;
  const { localPosRef, remotesRef, gameBridge, applyVolumesToUi } = args;
  if (data.id === localPosRef.current.id) return;
  const currentMap = useMapStore.getState().currentMapName;
  if (!passesMapFilter(data.mapName, currentMap)) return;
  const prev = remotesRef.current[data.id] || { x: 0, y: 0 };
  remotesRef.current[data.id] = { ...prev, x: data.x, y: data.y };
  if (gameBridge && typeof gameBridge.updateRemotePlayer === 'function')
    gameBridge.updateRemotePlayer(data.id, { x: data.x, y: data.y, direction: data.direction });
  scheduleBuildParticipantList(50);
  scheduleRefreshRosterFromRemotes(0);
  applyVolumesToUi();
}

function handlePlayerLeft(ctx: HandlerCtx, data: PlayerLeftMessage): void {
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

function handlePlayerDnd(ctx: HandlerCtx, data: PlayerDndMessage): void {
  const { args, scheduleBuildParticipantList } = ctx;
  const { remotesRef, gameBridge } = args;
  const entry = remotesRef.current[data.id];
  if (entry) entry.dnd = data.dnd;
  if (gameBridge && typeof gameBridge.updateRemotePlayerDnd === 'function')
    gameBridge.updateRemotePlayerDnd(data.id, data.dnd);
  scheduleBuildParticipantList(50);
}

function handlePlayerAvatar(ctx: HandlerCtx, data: PlayerAvatarMessage): void {
  const { args, scheduleBuildParticipantList } = ctx;
  const { localPosRef, remotesRef, gameBridge } = args;
  if (data.id === localPosRef.current.id) return;
  const entry = remotesRef.current[data.id];
  if (entry) entry.avatarId = data.avatarId;
  if (gameBridge && typeof gameBridge.updateRemotePlayer === 'function') {
    gameBridge.updateRemotePlayer(data.id, { avatarId: data.avatarId });
  }
  scheduleBuildParticipantList(50);
}

function handlePlayerMapChanged(ctx: HandlerCtx, data: PlayerMapChangedMessage): void {
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
    const next: { x: number; y: number; dnd?: boolean; avatarId?: string } = { x: data.x, y: data.y };
    if (data.dnd != null) next.dnd = data.dnd;
    if (data.avatarId) next.avatarId = data.avatarId;
    remotesRef.current[data.id] = next;
    if (data.identity) {
      colyseusToLivekitMap.current[data.id] = data.identity;
      if (data.name) identityToNameMap.current[data.identity] = data.name;
    }
    if (gameBridge && typeof gameBridge.addRemotePlayer === 'function') {
      gameBridge.addRemotePlayer(data.id, {
        x: data.x,
        y: data.y,
        direction: 'down',
        name: data.name,
        avatarId: data.avatarId,
        isNpc: data.isNpc,
      });
    }
    scheduleBuildParticipantList(50);
    emitCurrentMapIdentities();
    scheduleRefreshRosterFromRemotes(0);
  }
}

function handleStateChange(ctx: HandlerCtx, state: WorldRoomState): void {
  const { args, emitCurrentMapIdentities } = ctx;
  const { localPosRef, remotesRef, colyseusToLivekitMap, identityToNameMap, gameBridge } = args;
  try {
    const localId = localPosRef.current.id;
    if (localId && state.players) {
      const local = state.players.get(localId);
      syncLocalMapFromServer(local);
    }
  } catch {}
  const currentMap = useMapStore.getState().currentMapName;
  const players: Record<string, RemotePlayerSnapshot> = {};
  if (state.players) {
    state.players.forEach((value: PlayerSchema, key: string) => {
      if (value.identity) {
        colyseusToLivekitMap.current[key] = value.identity;
        if (value.name) identityToNameMap.current[value.identity] = value.name;
      }
      if (!passesMapFilter(value.mapName, currentMap)) return;
      const snapshot: RemotePlayerSnapshot = {
        x: value.x,
        y: value.y,
        direction: asPlayerDirection(value.direction),
      };
      if (value.dnd !== undefined) snapshot.dnd = value.dnd;
      if (value.identity !== undefined) snapshot.identity = value.identity;
      if (value.name !== undefined) snapshot.name = value.name;
      if (value.avatarId !== undefined) snapshot.avatarId = value.avatarId;
      if (value.isNpc !== undefined) snapshot.isNpc = value.isNpc;
      players[key] = snapshot;
    });
  }
  remotesRef.current = Object.fromEntries(
    Object.entries(players)
      .filter(([id]) => id !== localPosRef.current.id)
      .map(([id, p]) => [id, toRemotesEntry(p)]),
  );
  const filtered: Record<string, RemotePlayerData & { identity?: string }> = Object.fromEntries(
    Object.entries(players)
      .filter(([id]) => id !== localPosRef.current.id)
      .map(([id, p]): [string, RemotePlayerData & { identity?: string }] => {
        const livekitIdentity = p.identity || colyseusToLivekitMap.current[id] || id;
        const name = identityToNameMap.current[livekitIdentity] || p.name || livekitIdentity;
        return [id, { ...p, name, identity: livekitIdentity }];
      }),
  );
  if (gameBridge && typeof gameBridge.syncRemotePlayers === 'function') gameBridge.syncRemotePlayers(filtered);
  emitCurrentMapIdentities();
}

export function setupPlayerHandlers(
  room: WorldRoom,
  args: UseWorldRoomArgs,
  scheduleBuildParticipantList: (delay: number) => void,
  scheduleRefreshRosterFromRemotes: (delay: number) => void,
  options?: SetupPlayerHandlersOptions,
) {
  const ctx: HandlerCtx = {
    args,
    scheduleBuildParticipantList,
    scheduleRefreshRosterFromRemotes,
    emitCurrentMapIdentities: makeEmitMapIdentities(args),
  };
  room.onMessage('full_state', (data: FullStateMessage) => handleFullState(ctx, options, data));
  room.onMessage('player_joined', (data: PlayerJoinedMessage) => handlePlayerJoined(ctx, data));
  room.onMessage('player_moved', (data: PlayerMovedMessage) => handlePlayerMoved(ctx, data));
  room.onMessage('player_left', (data: PlayerLeftMessage) => handlePlayerLeft(ctx, data));
  room.onMessage('player_dnd', (data: PlayerDndMessage) => handlePlayerDnd(ctx, data));
  room.onMessage('player_avatar', (data: PlayerAvatarMessage) => handlePlayerAvatar(ctx, data));
  room.onMessage('player_map_changed', (data: PlayerMapChangedMessage) => handlePlayerMapChanged(ctx, data));
  room.onStateChange((state: WorldRoomState) => handleStateChange(ctx, state));
}
