/**
 * Roster-only onStateChange handler.
 *
 * Einzige Verantwortung: rosterByIdentityRef + setRoster aktualisieren
 * (inklusive cross-map-Sichtbarkeit, daher KEIN passesMapFilter — der Roster
 * zeigt absichtlich auch User auf anderen Maps).
 *
 * Mutation von remotesRef / colyseusToLivekitMap / identityToNameMap passiert
 * ausschliesslich im primary onStateChange in playerHandlers.ts.
 */
import type { UseWorldRoomArgs } from '../types';
import type { WorldRoom } from '../../types/colyseus';

interface RosterEntry {
  identity: string;
  name: string;
  online: boolean;
  x?: number;
  y?: number;
  lastSeen?: string;
}

export function setupRosterOnStateChange(
  room: WorldRoom,
  args: UseWorldRoomArgs,
  setRoster: (updater: (prev: RosterEntry[]) => RosterEntry[]) => void,
  me: { id: string; name?: string; email?: string },
): void {
  room.onStateChange((state: any) => {
    try {
      const { colyseusToLivekitMap, identityToNameMap, localPosRef } = args;
      const online: Record<string, { name: string; x: number; y: number }> = {};

      const iterateForRoster = (value: any, key: string) => {
        if (key === localPosRef.current.id) return;
        const livekitIdentity = value.identity || colyseusToLivekitMap.current[key] || key;
        const name = identityToNameMap.current[livekitIdentity] || value.name || livekitIdentity;
        online[livekitIdentity] = { name, x: value.x, y: value.y };
      };

      if (state.players) {
        if (typeof state.players.forEach === 'function') {
          state.players.forEach(iterateForRoster);
        } else if (typeof state.players.entries === 'function') {
          for (const [key, value] of state.players.entries()) iterateForRoster(value, key);
        } else if (state.players[Symbol.iterator]) {
          for (const [key, value] of state.players) iterateForRoster(value, key);
        }
      }

      // Local user via stable userId aufnehmen, damit presence-merge "self online" markiert.
      if (me?.id) {
        const lp = localPosRef.current;
        online[me.id] = { name: me.name || me.email || me.id, x: lp?.x ?? 0, y: lp?.y ?? 0 };
      }

      args.rosterByIdentityRef.current = online;
      setRoster((prev) => mergeRoster(prev, online));
    } catch {}
  });
}

function mergeRoster(
  prev: RosterEntry[],
  online: Record<string, { name: string; x: number; y: number }>,
): RosterEntry[] {
  const map = new Map<string, RosterEntry>();
  for (const r of prev) map.set(r.identity, { ...r, online: false });
  for (const [ident, v] of Object.entries(online)) {
    if (map.has(ident)) {
      map.set(ident, { ...(map.get(ident) as RosterEntry), name: v.name, online: true, x: v.x, y: v.y });
      continue;
    }
    let matchedKey: string | undefined;
    for (const [k, val] of map.entries()) {
      if ((val.name || '').toLowerCase() === (v.name || '').toLowerCase()) {
        matchedKey = k;
        break;
      }
    }
    if (matchedKey) {
      const cur = map.get(matchedKey)!;
      map.set(matchedKey, { ...cur, online: true, x: v.x, y: v.y });
    } else {
      map.set(ident, { identity: ident, name: v.name, online: true, x: v.x, y: v.y });
    }
  }
  return Array.from(map.values()).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}
