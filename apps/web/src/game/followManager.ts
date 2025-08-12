export class FollowManager {
  private targetId: string | null = null;
  private cancelOnDistance: number;

  constructor(cancelOnDistance: number) {
    this.cancelOnDistance = cancelOnDistance;
  }

  startFollowing(targetId: string) {
    this.targetId = targetId;
  }

  stop() {
    this.targetId = null;
  }

  getTarget() {
    return this.targetId;
  }

  update(local: { x: number; y: number }, targets: Record<string, { x: number; y: number }>) {
    if (!this.targetId) return { x: local.x, y: local.y, following: false };
    const t = targets[this.targetId];
    if (!t) return { x: local.x, y: local.y, following: false };
    const dx = t.x - local.x;
    const dy = t.y - local.y;
    const dist2 = dx * dx + dy * dy;
    if (dist2 > this.cancelOnDistance * this.cancelOnDistance) {
      this.stop();
      return { x: local.x, y: local.y, following: false };
    }
    // einfache Interpolation
    const alpha = 0.1;
    return { x: local.x + dx * alpha, y: local.y + dy * alpha, following: true };
  }
}
