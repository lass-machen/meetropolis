import { logger } from '../../logger.js';
import type { WorldRoom } from '../WorldRoom.js';
import { broadcastBubbleState, canonicalGroupId } from '../utils/bubbleHelpers.js';

export function handleBubbleUpdate(
  room: WorldRoom,
  data: { id?: string; members?: string[] },
): void {
  const raw = Array.isArray(data?.members) ? data.members : [];
  const filtered = Array.from(new Set(raw)).filter((id) => room.state.players.has(id));
  logger.info('[WorldRoom] bubble_update:', filtered);
  // Remove members from existing groups
  if (filtered.length > 0) {
    const toRemoveFrom: string[] = [];
    for (const [gid, mems] of Object.entries(room.bubbleGroups)) {
      if (mems.some((m) => filtered.includes(m))) toRemoveFrom.push(gid);
    }
    for (const gid of toRemoveFrom) delete room.bubbleGroups[gid];
  }
  // Empty list means: just dissolve, do not form a new group
  if (filtered.length >= 2) {
    const gid = data?.id && typeof data.id === 'string' && data.id.length > 0
      ? data.id
      : canonicalGroupId(filtered);
    room.bubbleGroups[gid] = filtered;
  }
  broadcastBubbleState(room);
}
