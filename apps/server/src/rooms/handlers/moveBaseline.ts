import type { Player } from '../WorldRoom.js';

interface MoveBaseline {
  acceptedAt: number;
  checkedAt: number;
}

// One baseline per player instance. A disconnected player leaves no retained session entry.
const moveBaselines = new WeakMap<Player, MoveBaseline>();

export function resetMoveBaseline(player: Player, now = performance.now()): MoveBaseline {
  const baseline = { acceptedAt: now, checkedAt: -Infinity };
  moveBaselines.set(player, baseline);
  return baseline;
}

export function getMoveBaseline(player: Player, now: number): MoveBaseline {
  return moveBaselines.get(player) ?? resetMoveBaseline(player, now);
}
