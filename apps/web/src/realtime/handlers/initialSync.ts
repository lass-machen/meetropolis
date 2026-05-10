/**
 * Force initial state sync - onStateChange feuert nicht fuer den initialen
 * State, und full_state kann vor den Handlern ankommen. Hier ziehen wir die
 * Spieler aus room.state.players nach dem Handler-Setup einmalig synchron raus.
 *
 * Symmetrie zu playerHandlers.full_state: erst lokalen Player aus dem State
 * synchronisieren, damit der Map-Filter danach auf dem korrekten currentMap
 * arbeitet.
 */
import type { UseWorldRoomArgs } from '../types';
import { useMapStore } from '../../state/mapStore';
import { passesMapFilter } from './mapFilter';
import type { PlayerSchema, WorldRoom } from '../../types/colyseus';

interface ForceInitialSyncDeps {
  room: WorldRoom;
  args: UseWorldRoomArgs;
  scheduleBuildParticipantList: (delay: number) => void;
  scheduleRefreshRosterFromRemotes: (delay: number) => void;
}

interface SyncedPlayer {
  x: number;
  y: number;
  direction: string;
  name?: string;
  dnd?: boolean;
  avatarId?: string;
  isNpc?: boolean;
  identity?: string;
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
        direction: value.direction,
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
    // Non-critical - full_state oder onStateChange holen es nach.
  }
}
