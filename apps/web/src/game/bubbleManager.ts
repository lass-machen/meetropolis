import { AVManager } from '../av/avManager';

export type PlayerPos = { id: string; x: number; y: number };

export class BubbleManager {
  private readonly radius: number;
  // Note: roomPrefix and joinedId are currently unused; they remain as placeholders for future room models.
  // private readonly roomPrefix = 'bubble';
  // private joinedId: string | null = null;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(radius: number, _av: AVManager | null) {
    this.radius = radius;
  }

  update(local: PlayerPos, others: PlayerPos[]) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.recompute(local, others), 150);
  }

  private recompute(local: PlayerPos, others: PlayerPos[]) {
    const inRange = others
      .filter((o) => {
        const dx = o.x - local.x;
        const dy = o.y - local.y;
        return dx * dx + dy * dy <= this.radius * this.radius;
      })
      .map((o) => o.id)
      .sort();
    // mark as used to satisfy TS noUnusedLocals
    void inRange;
    // Single-room model: the bubble is tracked only as a member set in the app state.
    // This class keeps the proximity logic for optional use but no longer drives a room.
  }

  setAV(_av: AVManager | null) {}
}
