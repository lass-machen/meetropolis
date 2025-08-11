import { AVManager } from '../av/avManager';

export type Polygon = { name: string; capacity?: number; points: { x: number; y: number }[] };

export class ZoneManager {
  private readonly av: AVManager;
  private readonly zones: Polygon[];
  private current?: string;

  constructor(zones: Polygon[], av: AVManager) {
    this.zones = zones;
    this.av = av;
  }

  update(pos: { x: number; y: number }) {
    const inside = this.zones.find(z => pointInPolygon(pos, z.points));
    if (inside && inside.name !== this.current) {
      this.current = inside.name;
      this.av.switchTo(`zone:${inside.name}`);
    } else if (!inside && this.current) {
      this.current = undefined;
      this.av.switchTo('lobby');
    }
  }
}

function pointInPolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i], pj = poly[j];
    if (((pi.y > p.y) !== (pj.y > p.y)) && (p.x < (pj.x - pi.x) * (p.y - pi.y) / (pj.y - pi.y + 1e-9) + pi.x)) {
      c = !c;
    }
  }
  return c;
}

