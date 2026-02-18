import { AVManager } from '../av/avManager';

export type Polygon = {
  name: string;
  capacity?: number;
  points: Array<{ x: number; y: number } | [number, number]>;
  type?: 'default' | 'portal';
  portalTarget?: string;
  portalSpawnX?: number;
  portalSpawnY?: number;
};

export class ZoneManager {
  private av: AVManager | null;
  private zones: Polygon[];
  private current: string | undefined;
  private room: { send: (type: string, data: unknown) => void; onMessage: (type: string, handler: (data: unknown) => void) => (() => void) } | null = null;
  private portalCooldownUntil: number = 0;

  constructor(zones: Polygon[], av: AVManager | null) {
    this.zones = zones;
    this.av = av;
  }

  setRoom(room: { send: (type: string, data: unknown) => void; onMessage: (type: string, handler: (data: unknown) => void) => (() => void) } | null) {
    this.room = room;
  }

  update(pos: { x: number; y: number }) {
    const inside = this.zones.find(z => pointInPolygon(pos, normalizePoints(z.points)));
    if (inside && inside.name !== this.current) {
      this.current = inside.name;

      // Portal detection
      if (inside.type === 'portal' && inside.portalTarget && this.room) {
        const now = Date.now();
        if (now > this.portalCooldownUntil) {
          this.portalCooldownUntil = now + 2000; // 2s cooldown
          import('./map/changeMap').then(mod => {
            mod.changeMap(inside.portalTarget!, this.room!);
          }).catch(e => {
            console.error('[ZoneManager] Failed to trigger portal:', e);
          });
        }
      }
    } else if (!inside && this.current) {
      this.current = undefined;
    }
  }

  setZones(zones: Polygon[]) {
    this.zones = zones;
    if (this.current && !this.zones.find(z => z.name === this.current)) {
      // Single-Room: keine Raumwechsel – nur State zurücksetzen
      this.current = undefined;
      // Legacy-Erwartung in Tests: beim Verlassen in 'lobby' wechseln
      try { (this.av as any)?.switchTo?.('lobby'); } catch {}
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
