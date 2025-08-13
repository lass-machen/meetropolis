import { AVManager } from '../av/avManager';

export type PlayerPos = { id: string; x: number; y: number };

export class BubbleManager {
  private readonly radius: number;
  // Hinweise: roomPrefix und joinedId werden aktuell nicht genutzt; belasse als Platzhalter für zukünftige Raummodelle
  // private readonly roomPrefix = 'bubble';
  // private joinedId: string | null = null;
  private timer?: any;

  constructor(radius: number, _av: AVManager | null) {
    this.radius = radius;
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
    // mark as used to satisfy TS noUnusedLocals
    void inRange;
    // Single-Room: Bubble wird nur noch als Mitglieder-Set im App-State geführt
    // Diese Klasse behält vorerst nur die Nähe-Logik (optional nutzbar), steuert aber keinen Raum mehr.
  }

  setAV(_av: AVManager | null) {}
}
