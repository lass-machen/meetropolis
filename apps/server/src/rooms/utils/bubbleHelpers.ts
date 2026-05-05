import type { WorldRoom } from '../WorldRoom.js';
import { broadcastToMap } from './broadcastHelpers.js';

export function getAllBubbleMembers(room: WorldRoom): string[] {
  const all: string[] = [];
  for (const members of Object.values(room.bubbleGroups)) {
    for (const m of members) { if (!all.includes(m)) all.push(m); }
  }
  return all;
}

export function canonicalGroupId(members: string[]): string {
  return Array.from(new Set(members)).sort().join('|');
}

// Compute valid groups (filter out disconnected players) and broadcast
// per-map slices to clients on the corresponding map. Behavior must
// match the original `WorldRoom.broadcastBubbleState` exactly.
export function broadcastBubbleState(room: WorldRoom): void {
  const validGroups = Object.entries(room.bubbleGroups).map(([id, members]) => ({
    id,
    members: members.filter((m) => room.state.players.has(m)),
  })).filter(g => Array.isArray(g.members) && g.members.length >= 2);

  const mapIds = new Set<string>();
  room.state.players.forEach((player) => {
    if (player.mapId) mapIds.add(player.mapId);
  });

  for (const mapId of mapIds) {
    const mapGroups = validGroups.filter(g =>
      g.members.every(m => {
        const p = room.state.players.get(m);
        return p && p.mapId === mapId;
      })
    );
    const mapMembers: string[] = [];
    for (const g of mapGroups) {
      for (const m of g.members) {
        if (!mapMembers.includes(m)) mapMembers.push(m);
      }
    }
    broadcastToMap(room, mapId, 'bubble_state', { groups: mapGroups, members: mapMembers });
  }
}
