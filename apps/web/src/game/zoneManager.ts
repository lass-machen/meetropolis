import { AVManager } from '../av/avManager';

export type Polygon = { name: string; capacity?: number; points: { x: number; y: number }[] };

export class ZoneManager {
  private av: AVManager | null;
  private zones: Polygon[];
  private current: string | undefined;

  constructor(zones: Polygon[], av: AVManager | null) {
    this.zones = zones;
    this.av = av;
  }

  update(pos: { x: number; y: number }) {
    const inside = this.zones.find(z => pointInPolygon(pos, z.points));
    if (inside && inside.name !== this.current) {
      this.current = inside.name;
      // Single-Room: kein Raumwechsel mehr
    } else if (!inside && this.current) {
      this.current = undefined;
      // Single-Room: kein Raumwechsel mehr
    }
  }

  setZones(zones: Polygon[]) {
    this.zones = zones;
    if (this.current && !this.zones.find(z => z.name === this.current)) {
      this.current = undefined;
      this.av?.switchTo('lobby');
    }
  }

  setAV(av: AVManager | null) {
    this.av = av;
  }

  getCurrent() {
    return this.current;
  }

  getZones() {
    return this.zones;
  }

  getCurrentPolygon(): Polygon | undefined {
    if (!this.current) return undefined;
    return this.zones.find(z => z.name === this.current);
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
