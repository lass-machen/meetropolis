import { AVManager } from '../av/avManager';

export type PlayerPos = { id: string; x: number; y: number };

export class BubbleManager {
  private readonly radius: number;
  private av: AVManager | null;
  private readonly roomPrefix = 'bubble';
  private joinedId: string | null = null;
  private timer?: any;

  constructor(radius: number, av: AVManager | null) {
    this.radius = radius;
    this.av = av;
  }

  update(local: PlayerPos, others: PlayerPos[]) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.recompute(local, others), 150);
  }

  private recompute(local: PlayerPos, others: PlayerPos[]) {
    const inRange = others.filter(o => {
      const dx = o.x - local.x;
      const dy = o.y - local.y;
      return dx * dx + dy * dy <= this.radius * this.radius;
    }).map(o => o.id).sort();
    const key = [local.id, ...inRange].join('-');
    // Single-Room: Bubble wird nur noch als Mitglieder-Set im App-State geführt
    // Diese Klasse behält vorerst nur die Nähe-Logik (optional nutzbar), steuert aber keinen Raum mehr.
  }

  setAV(av: AVManager | null) {
    this.av = av;
  }
}
