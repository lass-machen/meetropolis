import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ATELIER_STANDARD_MAP_FILE } from './atelierStandardMap.js';
import { TmjSchema } from './tmjService.js';

interface Property {
  name: string;
  value: unknown;
}

interface MapObject {
  name: string;
  type: string;
  gid?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  polygon?: Array<{ x: number; y: number }>;
  properties?: Property[];
}

interface Layer {
  name: string;
  type: string;
  data?: number[];
  objects?: MapObject[];
}

interface Tileset {
  firstgid: number;
  tilecount: number;
  image: string;
  name: string;
}

interface StandardMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  tilesets: Tileset[];
  layers: Layer[];
  properties: Property[];
}

interface CatalogAsset {
  id: string;
  url: string;
  width: number;
  height: number;
  category: string;
  collide: boolean;
  collisionBaseHeight: number;
  renderLayer: string;
}

interface Catalog {
  palette: { packUuid: string };
  environmentAssets: CatalogAsset[];
  withheldAutotile: { url: string; active: boolean };
}

interface ManifestItem {
  id: string;
  dataURL: string;
}

interface Manifest {
  terrain: ManifestItem[];
  structures: ManifestItem[];
  objects: ManifestItem[];
}

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const publicRoot = resolve(repoRoot, 'apps/web/public');
const mapPath = resolve(publicRoot, 'maps', ATELIER_STANDARD_MAP_FILE);
const catalogPath = resolve(publicRoot, 'assets/atelier/v1/catalog.json');
const manifestPath = resolve(repoRoot, 'apps/server/prisma/seed-data/asset-packs/atelier-v1/holz.json');
const tmj = JSON.parse(readFileSync(mapPath, 'utf8')) as StandardMap;
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Catalog;
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;

function layer(name: string): Layer {
  const result = tmj.layers.find((entry) => entry.name === name);
  if (!result) throw new Error(`Missing layer '${name}'.`);
  return result;
}

function property(object: { properties?: Property[] }, name: string): unknown {
  return object.properties?.find((entry) => entry.name === name)?.value;
}

function assetForObject(object: MapObject): CatalogAsset {
  if (!object.gid) throw new Error(`Object '${object.name}' has no gid.`);
  const sorted = [...tmj.tilesets].sort((a, b) => a.firstgid - b.firstgid);
  const tileset = [...sorted].reverse().find((entry) => object.gid! >= entry.firstgid);
  if (!tileset) throw new Error(`Object '${object.name}' has no tileset.`);
  const asset = catalog.environmentAssets.find((entry) => entry.url === tileset.image);
  if (!asset) throw new Error(`Tileset '${tileset.name}' is not in the Atelier catalog.`);
  return asset;
}

function tilePoint(point: { x: number; y: number }): [number, number] {
  return [Math.floor(point.x / tmj.tilewidth), Math.floor(point.y / tmj.tileheight)];
}

function index(x: number, y: number): number {
  return y * tmj.width + x;
}

function absoluteFirstPoint(object: MapObject): { x: number; y: number } {
  const point = object.polygon?.[0];
  if (!point) throw new Error(`Zone '${object.name}' has no polygon.`);
  return { x: object.x + point.x, y: object.y + point.y };
}

function reachableTiles(collision: number[], start: [number, number]): Set<string> {
  const key = (x: number, y: number) => `${x},${y}`;
  const queue: Array<[number, number]> = [start];
  const reached = new Set([key(...start)]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const [x, y] = queue[cursor];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as Array<[number, number]>) {
      const nextX = x + dx;
      const nextY = y + dy;
      const nextKey = key(nextX, nextY);
      if (nextX < 0 || nextY < 0 || nextX >= tmj.width || nextY >= tmj.height) continue;
      if (collision[index(nextX, nextY)] || reached.has(nextKey)) continue;
      reached.add(nextKey);
      queue.push([nextX, nextY]);
    }
  }
  return reached;
}

describe('Atelier v1 standard map', () => {
  it('satisfies the TMJ contract and uses only existing checked-in assets', () => {
    expect(TmjSchema.safeParse(tmj).success).toBe(true);
    expect([tmj.width, tmj.height, tmj.tilewidth, tmj.tileheight]).toEqual([60, 42, 16, 16]);
    expect(tmj.layers.map((entry) => entry.name)).toEqual([
      'Ground',
      'Structures',
      'Furniture',
      'Decor',
      'Collision',
      'Zones',
      'Workplaces',
      'Points',
    ]);
    expect(catalog.withheldAutotile.active).toBe(false);
    expect(tmj.tilesets.some((tileset) => tileset.image === catalog.withheldAutotile.url)).toBe(false);

    for (const tileset of tmj.tilesets) {
      expect(tileset.firstgid).toBeGreaterThan(0);
      expect(tileset.tilecount).toBeGreaterThan(0);
      expect(tileset.image.startsWith('/assets/atelier/v1/')).toBe(true);
      expect(existsSync(resolve(publicRoot, tileset.image.slice(1))), tileset.image).toBe(true);
    }

    const sorted = [...tmj.tilesets].sort((a, b) => a.firstgid - b.firstgid);
    for (const current of sorted) {
      const next = sorted[sorted.indexOf(current) + 1];
      expect(next?.firstgid ?? current.firstgid + current.tilecount).toBeGreaterThanOrEqual(
        current.firstgid + current.tilecount,
      );
    }
  });

  it('carries exact catalog metadata on every placed asset', () => {
    const manifestByUrl = new Map(
      [...manifest.terrain, ...manifest.structures, ...manifest.objects].map((item) => [item.dataURL, item.id]),
    );
    const placed = ['Structures', 'Furniture', 'Decor'].flatMap((name) => layer(name).objects ?? []);
    expect(placed.length).toBeGreaterThan(0);
    expect(layer('Structures').objects?.some((object) => assetForObject(object).id === 'wall')).toBe(true);
    expect(layer('Structures').objects?.some((object) => assetForObject(object).id === 'door_open')).toBe(true);

    const interiorWalls = (layer('Structures').objects ?? []).filter((object) => object.name.startsWith('loft-wall-'));
    for (const wall of interiorWalls) {
      const tileX = Number(property(wall, 'tileX'));
      const tileY = Number(property(wall, 'tileY'));
      expect(
        interiorWalls.some(
          (candidate) =>
            Number(property(candidate, 'tileY')) === tileY &&
            Math.abs(Number(property(candidate, 'tileX')) - tileX) === 1,
        ),
        `${wall.name} belongs to an unsupported horizontal regular-wall run`,
      ).toBe(false);
    }

    for (const object of placed) {
      const asset = assetForObject(object);
      expect(property(object, 'assetPackUuid')).toBe(catalog.palette.packUuid);
      expect(property(object, 'itemId')).toBe(manifestByUrl.get(asset.url));
      expect(property(object, 'category')).toBe(asset.category);
      expect(property(object, 'collide')).toBe(asset.collide);
      expect(property(object, 'collisionBaseHeight')).toBe(asset.collisionBaseHeight);
      expect(property(object, 'renderLayer')).toBe(asset.renderLayer);
      expect([object.width, object.height]).toEqual([asset.width, asset.height]);
      expect(property(object, 'footprintW')).toBe(Math.ceil(asset.width / tmj.tilewidth));
      expect(property(object, 'footprintH')).toBe(Math.ceil(asset.height / tmj.tileheight));
    }
  });

  it('keeps the collision layer synchronized with the room boundary and placed assets', () => {
    const ground = layer('Ground').data ?? [];
    const collision = layer('Collision').data ?? [];
    expect(ground).toHaveLength(tmj.width * tmj.height);
    expect(collision).toHaveLength(tmj.width * tmj.height);
    const expected = ground.map((gid) => (gid > 0 ? 0 : 1));

    for (const object of ['Structures', 'Furniture', 'Decor'].flatMap((name) => layer(name).objects ?? [])) {
      const asset = assetForObject(object);
      if (!asset.collide) continue;
      const tileX = Number(property(object, 'tileX'));
      const tileY = Number(property(object, 'tileY'));
      const footprintW = Number(property(object, 'footprintW'));
      const footprintH = Number(property(object, 'footprintH'));
      const rows = asset.collisionBaseHeight > 0 ? Math.min(asset.collisionBaseHeight, footprintH) : footprintH;
      for (let dy = footprintH - rows; dy < footprintH; dy++) {
        for (let dx = 0; dx < footprintW; dx++) {
          const x = tileX + dx;
          const y = tileY + dy;
          if (x >= 0 && y >= 0 && x < tmj.width && y < tmj.height) expected[index(x, y)] = 1;
        }
      }
    }

    expect(collision).toEqual(expected);
  });

  it('has a walkable spawn, zone start points and route to every workplace', () => {
    const ground = layer('Ground').data ?? [];
    const collision = layer('Collision').data ?? [];
    const spawn = layer('Points').objects?.find((object) => object.type === 'spawn');
    if (!spawn) throw new Error('Missing spawn object.');
    expect(property(tmj, 'spawnX')).toBe(spawn.x);
    expect(property(tmj, 'spawnY')).toBe(spawn.y);
    const spawnTile = tilePoint(spawn);
    expect(collision[index(...spawnTile)]).toBe(0);
    const reached = reachableTiles(collision, spawnTile);

    const zones = layer('Zones').objects ?? [];
    expect(zones).toHaveLength(5);
    for (const zone of zones) {
      expect(zone.type).toBe('zone');
      expect(zone.polygon?.length).toBeGreaterThanOrEqual(3);
      const start = tilePoint(absoluteFirstPoint(zone));
      expect(collision[index(...start)], `${zone.name} starts on a collision`).toBe(0);
      expect(reached.has(start.join(',')), `${zone.name} cannot be reached`).toBe(true);
    }

    const workplaces = layer('Workplaces').objects ?? [];
    const furniture = layer('Furniture').objects ?? [];
    expect(workplaces).toHaveLength(6);
    for (const workplace of workplaces) {
      const approach = tilePoint(workplace);
      expect(collision[index(...approach)], `${workplace.name} approach is blocked`).toBe(0);
      expect(reached.has(approach.join(',')), `${workplace.name} cannot be reached`).toBe(true);
      const desk = furniture.find((object) => object.name === workplace.name);
      const chair = furniture.find((object) => object.name === workplace.name.replace(/-desk$/, '-chair'));
      if (!desk || !chair) throw new Error(`Missing desk or chair for '${workplace.name}'.`);
      expect(chair.x).toBe(desk.x + 16);
      expect(chair.y - chair.height).toBe(desk.y);
    }

    const unreachable = ground.flatMap((gid, position) => {
      if (!gid || collision[position]) return [];
      const x = position % tmj.width;
      const y = Math.floor(position / tmj.width);
      return reached.has(`${x},${y}`) ? [] : [[x, y]];
    });
    expect(unreachable).toEqual([]);
  });
});
