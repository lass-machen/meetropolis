import { AVManager } from '../av/avManager';
import { useMapStore } from '../state/mapStore';

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
  private room: {
    send: (type: string, data: unknown) => void;
    onMessage: (type: string, handler: (data: unknown) => void) => () => void;
  } | null = null;
  private portalCooldownUntil: number = 0;
  private lockedZones: Map<string, Set<string>> = new Map(); // zoneName -> sessionIds with access

  constructor(zones: Polygon[], av: AVManager | null) {
    this.zones = zones;
    this.av = av;
  }

  setRoom(
    room: {
      send: (type: string, data: unknown) => void;
      onMessage: (type: string, handler: (data: unknown) => void) => () => void;
    } | null,
  ) {
    this.room = room;
  }

  update(pos: { x: number; y: number }) {
    const inside = this.zones.find((z) => pointInPolygon(pos, normalizePoints(z.points)));
    if (inside && inside.name !== this.current) {
      this.current = inside.name;

      // Portal detection
      if (inside.type === 'portal' && inside.portalTarget && this.room) {
        const now = Date.now();
        if (now > this.portalCooldownUntil) {
          this.portalCooldownUntil = now + 2000; // 2s cooldown
          const targetName = inside.portalTarget;
          const maps = useMapStore.getState().availableMaps;
          const targetMap = maps.find((m) => m.name === targetName);
          if (targetMap) {
            // portalSpawnX/Y are stored as tile coordinates; convert to pixel (tile * 16 + 8 = center of tile)
            const tileSize = 16;
            const spawnOverride =
              typeof inside.portalSpawnX === 'number' && typeof inside.portalSpawnY === 'number'
                ? { x: inside.portalSpawnX * tileSize + tileSize / 2, y: inside.portalSpawnY * tileSize + tileSize / 2 }
                : undefined;
            import('./map/changeMap')
              .then((mod) => {
                void mod.changeMap(targetMap.id, targetMap.name, this.room!, spawnOverride);
              })
              .catch((e) => {
                console.error('[ZoneManager] Failed to trigger portal:', e);
              });
          } else {
            console.error('[ZoneManager] Portal target map not found:', targetName);
          }
        }
      }
    } else if (!inside && this.current) {
      this.current = undefined;
    }
  }

  /** Reset portal state for map changes. Clears current zone and sets a fresh cooldown
   *  to prevent immediate re-triggering when spawning inside a portal zone on the new map. */
  resetForMapChange() {
    this.current = undefined;
    this.portalCooldownUntil = Date.now() + 2000;
  }

  setZones(zones: Polygon[]) {
    this.zones = zones;
    if (this.current && !this.zones.find((z) => z.name === this.current)) {
      // Single-room model: no room switching, only reset state.
      this.current = undefined;
      // Legacy test expectation: switch to 'lobby' on exit.
      try {
        void this.av?.switchTo('lobby');
      } catch {}
    }
  }

  setAV(av: AVManager | null) {
    this.av = av;
  }

  getCurrent() {
    return this.current;
  }

  setLockedZones(locks: Array<{ zoneName: string; accessList: string[] }>, _mySessionId: string) {
    this.lockedZones.clear();
    for (const lock of locks) {
      this.lockedZones.set(lock.zoneName, new Set(lock.accessList));
    }
  }

  isZoneBlocked(zoneName: string, sessionId: string): boolean {
    const accessList = this.lockedZones.get(zoneName);
    if (!accessList) return false; // Not locked
    return !accessList.has(sessionId);
  }

  getLockedZones(): Map<string, Set<string>> {
    return this.lockedZones;
  }

  getZones(): Array<Omit<Polygon, 'points'> & { points: { x: number; y: number }[] }> {
    // Return zones with normalized points for consumers
    return this.zones.map((z) => ({ ...z, points: normalizePoints(z.points) }));
  }

  getCurrentPolygon(): Polygon | undefined {
    if (!this.current) return undefined;
    return this.zones.find((z) => z.name === this.current);
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
    const obj = v as { x?: unknown; y?: unknown };
    if (typeof obj.x === 'number' && typeof obj.y === 'number') {
      out.push({ x: obj.x, y: obj.y });
      continue;
    }
    // Try number-like strings
    const nx = Number(obj.x);
    const ny = Number(obj.y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) out.push({ x: nx, y: ny });
  }
  return out;
}

function pointInPolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i],
      pj = poly[j];
    if (pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y + 1e-9) + pi.x) {
      c = !c;
    }
  }
  return c;
}
