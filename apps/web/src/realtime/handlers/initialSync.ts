/**
 * Force initial state sync - onStateChange does not fire for the initial
 * state, and full_state can arrive before the handlers are wired up. Here we
 * pull the players out of room.state.players once, synchronously, after
 * handler setup.
 *
 * Symmetric to playerHandlers.full_state: first sync the local player out of
 * the state so the map filter operates on the correct currentMap afterwards.
 */
import type { UseWorldRoomArgs } from '../types';
import { useMapStore } from '../../state/mapStore';
import { passesMapFilter } from './mapFilter';
import type { PlayerSchema, WorldRoom } from '../../types/colyseus';
import type { PlayerDirection } from '../../types/game';

interface ForceInitialSyncDeps {
  room: WorldRoom;
  args: UseWorldRoomArgs;
  scheduleBuildParticipantList: (delay: number) => void;
  scheduleRefreshRosterFromRemotes: (delay: number) => void;
}

interface SyncedPlayer {
  x: number;
  y: number;
  direction: PlayerDirection;
  name?: string;
  dnd?: boolean;
  avatarId?: string;
  isNpc?: boolean;
  identity?: string;
}

const VALID_DIRECTIONS: ReadonlySet<PlayerDirection> = new Set(['up', 'down', 'left', 'right']);

function asPlayerDirection(value: string | undefined): PlayerDirection {
  return value && VALID_DIRECTIONS.has(value as PlayerDirection) ? (value as PlayerDirection) : 'down';
}

export function forceInitialPlayerSync(deps: ForceInitialSyncDeps): void {
  const { room, args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes } = deps;
  const { identityToNameMap, colyseusToLivekitMap, gameBridge } = args;
  try {
    if (!room.state?.players) return;

    try {
      const local = room.state.players.get(room.sessionId);
      if (local?.mapId && local.mapName) {
        const mapState = useMapStore.getState();
        if (!mapState.currentMapId || mapState.currentMapId !== local.mapId) {
          mapState.setCurrentMap(local.mapId, local.mapName);
        }
      }
    } catch {}

    const currentMap = useMapStore.getState().currentMapName;
    const players: Record<string, SyncedPlayer> = {};
    const iteratePlayers = (value: PlayerSchema, key: string) => {
      if (key === room.sessionId) return;
      if (!passesMapFilter(value.mapName, currentMap)) return;
      players[key] = {
        x: value.x,
        y: value.y,
        direction: asPlayerDirection(value.direction),
        name: value.name,
        dnd: value.dnd,
        avatarId: value.avatarId,
        isNpc: value.isNpc,
        identity: value.identity,
      };
      if (value.identity && value.name) identityToNameMap.current[value.identity] = value.name;
      if (value.identity) colyseusToLivekitMap.current[key] = value.identity;
    };
    room.state.players.forEach(iteratePlayers);

    const filtered = Object.fromEntries(
      Object.entries(players).map(([id, p]): [string, SyncedPlayer & { name: string; identity: string }] => {
        const livekitIdentity = p.identity || colyseusToLivekitMap.current[id] || id;
        const name = identityToNameMap.current[livekitIdentity] || p.name || livekitIdentity;
        return [id, { ...p, name, identity: livekitIdentity }];
      }),
    );

    if (Object.keys(filtered).length > 0) {
      gameBridge.syncRemotePlayers(filtered);
      args.remotesRef.current = Object.fromEntries(
        Object.entries(filtered).map(([id, p]) => {
          const entry: { x: number; y: number; dnd?: boolean; avatarId?: string } = { x: p.x, y: p.y };
          if (p.dnd !== undefined) entry.dnd = p.dnd;
          if (p.avatarId !== undefined) entry.avatarId = p.avatarId;
          return [id, entry];
        }),
      );
      scheduleBuildParticipantList(0);
      scheduleRefreshRosterFromRemotes(0);
    }
  } catch {
    // Non-critical - full_state or onStateChange will catch up later.
  }
}
