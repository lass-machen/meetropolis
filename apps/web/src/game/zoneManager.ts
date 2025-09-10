import { AVManager } from '../av/avManager';

export type Polygon = { name: string; capacity?: number; points: Array<{ x: number; y: number } | [number, number]> };

export class ZoneManager {
  private av: AVManager | null;
  private zones: Polygon[];
  private current: string | undefined;

  constructor(zones: Polygon[], av: AVManager | null) {
    this.zones = zones;
    this.av = av;
  }

  update(pos: { x: number; y: number }) {
    const inside = this.zones.find(z => pointInPolygon(pos, normalizePoints(z.points)));
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
      // Single-Room: keine Raumwechsel – nur State zurücksetzen
      this.current = undefined;
    }
  }

  setAV(av: AVManager | null) {
    this.av = av;
  }

  getCurrent() {
    return this.current;
  }

  getZones() {
    // Return zones with normalized points for consumers
    return this.zones.map(z => ({ ...z, points: normalizePoints(z.points) as any }));
  }

  getCurrentPolygon(): Polygon | undefined {
    if (!this.current) return undefined;
    return this.zones.find(z => z.name === this.current);
  }
}

function normalizePoints(points: Array<{ x: number; y: number } | [number, number]>): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const v of Array.isArray(points) ? points : []) {
    if (!v) continue;
    if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
      out.push({ x: v[0], y: v[1] });
      continue;
    }
    const anyV = v as any;
    if (typeof anyV.x === 'number' && typeof anyV.y === 'number') {
      out.push({ x: anyV.x, y: anyV.y });
      continue;
    }
    // Try number-like strings
    const nx = Number(anyV.x);
    const ny = Number(anyV.y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) out.push({ x: nx, y: ny });
  }
  return out;
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
