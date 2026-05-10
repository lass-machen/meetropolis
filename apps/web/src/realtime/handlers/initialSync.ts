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
import type { WorldRoom } from '../../types/colyseus';

interface ForceInitialSyncDeps {
  room: WorldRoom;
  args: UseWorldRoomArgs;
  scheduleBuildParticipantList: (delay: number) => void;
  scheduleRefreshRosterFromRemotes: (delay: number) => void;
}

export function forceInitialPlayerSync(deps: ForceInitialSyncDeps): void {
  const { room, args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes } = deps;
  const { identityToNameMap, colyseusToLivekitMap, gameBridge } = args;
  try {
    if (!room.state?.players) return;

    try {
      const local = typeof room.state.players.get === 'function' ? room.state.players.get(room.sessionId) : undefined;
      if (local?.mapId && local.mapName) {
        const mapState = useMapStore.getState();
        if (!mapState.currentMapId || mapState.currentMapId !== local.mapId) {
          mapState.setCurrentMap(local.mapId, local.mapName);
        }
      }
    } catch {}

    const currentMap = useMapStore.getState().currentMapName;
    const players: Record<string, any> = {};
    const iteratePlayers = (value: any, key: string) => {
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
    if (typeof room.state.players.forEach === 'function') {
      room.state.players.forEach(iteratePlayers);
    } else if (typeof room.state.players.entries === 'function') {
      for (const [key, value] of room.state.players.entries()) iteratePlayers(value, key);
    }

    const filtered = Object.fromEntries(
      Object.entries(players).map(([id, p]: [string, any]) => {
        const livekitIdentity = p.identity || colyseusToLivekitMap.current[id] || id;
        const name = identityToNameMap.current[livekitIdentity] || p.name || livekitIdentity;
        return [id, { ...p, name, identity: livekitIdentity }];
      }),
    );

    if (Object.keys(filtered).length > 0) {
      gameBridge.syncRemotePlayers(filtered);
      args.remotesRef.current = Object.fromEntries(
        Object.entries(filtered).map(([id, p]: [string, any]) => [
          id,
          { x: p.x, y: p.y, dnd: p.dnd, avatarId: p.avatarId },
        ]),
      );
      scheduleBuildParticipantList(0);
      scheduleRefreshRosterFromRemotes(0);
    }
  } catch {
    // Non-critical - full_state oder onStateChange holen es nach.
  }
}
