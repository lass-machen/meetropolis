import { assetCollisionFootprint, TILE_SIZE, themes, type AssetLibrary, type ThemeId } from './assets.ts';
import { Pixels } from './pixels.ts';
import type { OfficePreset, Point, Rect } from './office-model.ts';
export type { Point, Rect } from './office-model.ts';

export function zoneAt(p: Point, office: OfficePreset) {
  return office.zones.find((z) => p.x >= z.x && p.x < z.x + z.w && p.y >= z.y && p.y < z.y + z.h);
}

export function collisions(office: OfficePreset, assets: AssetLibrary): Rect[] {
  return [
    ...office.placements.flatMap((item) => {
      const foot = assetCollisionFootprint(item.asset, assets[item.asset]);
      return foot ? [{ ...foot, x: item.x + foot.x, y: item.y + foot.y }] : [];
    }),
    ...office.walls.map((p) => ({ ...p, w: TILE_SIZE, h: TILE_SIZE })),
  ];
}

/** Der Fußabdruck bleibt unabhängig von Haaren, Hüten und Sprite-Höhe. */
export function canStand(p: Point, obstacles: Rect[], roomBounds: Rect): boolean {
  const foot = { x: p.x - 5, y: p.y - 3, w: 10, h: 6 };
  if (
    foot.x < roomBounds.x ||
    foot.y < roomBounds.y ||
    foot.x + foot.w > roomBounds.x + roomBounds.w ||
    foot.y + foot.h > roomBounds.y + roomBounds.h
  )
    return false;
  return !obstacles.some(
    (r) => foot.x < r.x + r.w && foot.x + foot.w > r.x && foot.y < r.y + r.h && foot.y + foot.h > r.y,
  );
}

/** Kleine Teilschritte verhindern, dass langsame Frames Möbel überspringen. */
export function move(start: Point, delta: Point, obstacles: Rect[], bounds: Rect): Point {
  let { x, y } = start;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(delta.x), Math.abs(delta.y)) / 2));
  for (let i = 0; i < steps; i++) {
    const dx = delta.x / steps;
    const dy = delta.y / steps;
    if (canStand({ x: x + dx, y }, obstacles, bounds)) x += dx;
    if (canStand({ x, y: y + dy }, obstacles, bounds)) y += dy;
  }
  return { x, y };
}

/** Vier Nachbarn am 8-Pixel-Raster: Klickziele führen um Möbel herum. */
export function findPath(start: Point, target: Point, obstacles: Rect[], bounds: Rect): Point[] {
  if (!canStand(target, obstacles, bounds)) return [];
  const step = 8;
  const origin = { x: start.x, y: start.y };
  const goal = {
    x: Math.round((target.x - origin.x) / step),
    y: Math.round((target.y - origin.y) / step),
  };
  const key = (x: number, y: number): string => `${x},${y}`;
  const nodes: { x: number; y: number; parent: number }[] = [{ x: 0, y: 0, parent: -1 }];
  const seen = new Set(['0,0']);
  let found = -1;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const at = { x: origin.x + n.x * step, y: origin.y + n.y * step };
    if (Math.abs(at.x - target.x) <= step && Math.abs(at.y - target.y) <= step) {
      const end = move(at, { x: target.x - at.x, y: target.y - at.y }, obstacles, bounds);
      if (Math.hypot(end.x - target.x, end.y - target.y) < 0.01) {
        found = i;
        break;
      }
    }
    const directions = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].sort(
      (a, b) =>
        Math.abs(n.x + a[0] - goal.x) +
        Math.abs(n.y + a[1] - goal.y) -
        Math.abs(n.x + b[0] - goal.x) -
        Math.abs(n.y + b[1] - goal.y),
    );
    for (const [dx, dy] of directions) {
      const x = n.x + dx;
      const y = n.y + dy;
      if (seen.has(key(x, y))) continue;
      seen.add(key(x, y));
      const next = { x: origin.x + x * step, y: origin.y + y * step };
      const moved = move(at, { x: dx * step, y: dy * step }, obstacles, bounds);
      if (Math.hypot(moved.x - next.x, moved.y - next.y) < 0.01) nodes.push({ x, y, parent: i });
    }
  }
  if (found < 0) return [];
  const result = [target];
  while (nodes[found].parent >= 0) {
    const node = nodes[found];
    result.unshift({
      x: origin.x + node.x * step,
      y: origin.y + node.y * step,
    });
    found = node.parent;
  }
  return result;
}

export function roomBackground(theme: ThemeId, assets: AssetLibrary, office: OfficePreset): Pixels {
  const c = themes[theme];
  const b = office.bounds;
  const p = new Pixels(office.world.width, office.world.height);
  p.rect(0, 0, p.width, p.height, '#e7ece8');
  p.rect(b.x - 8, b.y - 36, b.w + 20, b.h + 48, '#c8d3ca');
  const floor = new Pixels(b.w, b.h);
  for (let y = 0; y < b.h; y += assets.floor.height)
    for (let x = 0; x < b.w; x += assets.floor.width) floor.stamp(assets.floor, x, y);
  p.stamp(floor, b.x, b.y);
  for (const z of office.zones) {
    if (!z.surface) continue;
    p.rect(z.x - 2, z.y - 2, z.w + 4, z.h + 4, c.carpetShade);
    const surface = new Pixels(z.w, z.h);
    if (z.surface === 'garden') {
      surface.rect(0, 0, z.w, z.h, c.leafLight);
      for (let y = 8; y < z.h; y += 24)
        for (let x = 8; x < z.w; x += 32) {
          surface.rect(x, y, 3, 1, c.leaf);
          surface.rect(x + 14, y + 7, 2, 1, c.leaf);
        }
    } else {
      for (let y = 0; y < z.h; y += 16) for (let x = 0; x < z.w; x += 16) surface.stamp(assets.carpet, x, y);
    }
    p.stamp(surface, z.x, z.y);
    p.rect(z.x, z.y, z.w, 2, c.carpetLight);
  }
  for (let x = b.x; x < b.x + b.w; x += 16) p.stamp(assets.wall, x, b.y - 48);
  p.rect(b.x - 8, b.y - 48, 8, b.h + 56, c.wallShade);
  p.rect(b.x - 8, b.y - 48, 3, b.h + 56, c.trim);
  p.rect(b.x + b.w, b.y - 48, 8, b.h + 56, c.wallShade);
  p.rect(b.x + b.w + 5, b.y - 48, 3, b.h + 56, c.trim);
  p.rect(b.x, b.y, b.w, 3, c.floorShade);
  p.rect(b.x - 8, b.y + b.h, b.w + 16, 5, c.trim);
  p.rect(b.x - 6, b.y + b.h, b.w + 12, 2, c.woodLight);
  // Eine helle Schwelle macht die Ankunft auch ohne Türanimation lesbar.
  p.rect(office.spawn.x - 24, b.y + b.h, 48, 5, c.floorLight);
  return p;
}

export interface RoomSprite extends Point {
  key: string;
  pixels: Pixels;
  depth: number;
}

/** Zeichnung und Blockade verwenden dieselben Wandzellen. */
export function roomSprites(office: OfficePreset, assets: AssetLibrary): RoomSprite[] {
  const sprites: RoomSprite[] = office.placements.map((item) => ({
    x: item.x,
    y: item.y,
    key: item.asset,
    pixels: assets[item.asset],
    depth: item.y + assets[item.asset].height,
  }));
  const cells = new Set(office.walls.map((p) => `${p.x},${p.y}`));
  const tiles = new Map<number, Pixels>();
  for (const wall of office.walls) {
    const mask =
      Number(cells.has(`${wall.x},${wall.y - 16}`)) |
      (Number(cells.has(`${wall.x + 16},${wall.y}`)) << 1) |
      (Number(cells.has(`${wall.x},${wall.y + 16}`)) << 2) |
      (Number(cells.has(`${wall.x - 16},${wall.y}`)) << 3);
    let pixels = tiles.get(mask);
    if (!pixels) {
      pixels = new Pixels(16, 48);
      const atlas = assets.wall_set;
      for (let y = 0; y < 48; y++) {
        const index = (((mask >> 2) * 48 + y) * atlas.width + (mask % 4) * 16) * 4;
        pixels.data.set(atlas.data.subarray(index, index + 64), y * 64);
      }
      tiles.set(mask, pixels);
    }
    sprites.push({
      x: wall.x,
      y: wall.y - 32,
      key: `wall-mask-${mask}`,
      pixels,
      depth: wall.y + 16,
    });
  }
  return sprites.sort((a, b) => a.depth - b.depth);
}

/** Ein Rasterdurchlauf liefert die Szene und sämtliche Raumvorschauen. */
export function prepareRoom(theme: ThemeId, assets: AssetLibrary, office: OfficePreset) {
  return {
    background: roomBackground(theme, assets, office),
    sprites: roomSprites(office, assets),
  };
}
export type RoomRender = ReturnType<typeof prepareRoom>;

export function flattenRoom(room: RoomRender): Pixels {
  const result = new Pixels(room.background.width, room.background.height);
  result.data.set(room.background.data);
  for (const item of room.sprites) result.stamp(item.pixels, item.x, item.y);
  return result;
}

export function roomImage(theme: ThemeId, assets: AssetLibrary, office: OfficePreset): Pixels {
  return flattenRoom(prepareRoom(theme, assets, office));
}
