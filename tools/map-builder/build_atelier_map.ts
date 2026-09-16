/**
 * Convert the checked-in Team-Loft study into the production TMJ format.
 *
 * The study remains the canonical layout recipe. This converter adds the
 * production concerns that deliberately do not exist in the Atelier preview:
 * tilesets, object metadata, collision, audio-zone polygons and spawn points.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { officePresets } from '../asset-lab/src/office-presets.ts';
import type { OfficePreset, OfficeZone, Point } from '../asset-lab/src/office-model.ts';

const TILE = 16;
const PACK_UUID = '4664b745-6bad-4d86-ae8f-591c57567692';
const MAP_NAME = 'office-atelier-v1';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const CATALOG_PATH = resolve(REPO_ROOT, 'apps/web/public/assets/atelier/v1/catalog.json');
const OUTPUT_PATH = resolve(REPO_ROOT, `apps/web/public/maps/${MAP_NAME}.json`);

interface CatalogAsset {
  id: string;
  url: string;
  width: number;
  height: number;
  category: 'terrain' | 'structures' | 'objects';
  collide: boolean;
  collisionBaseHeight: number;
  renderLayer: 'floor' | 'sorted' | 'overhead';
}

interface Catalog {
  schema: string;
  generation: string;
  palette: { packUuid: string };
  worldGrid: { tileWidth: number; tileHeight: number };
  manifest: string;
  environmentAssets: CatalogAsset[];
  floorAtlas: { assetId: string; tileWidth: number; tileHeight: number; columns: number; rows: number };
  withheldAutotile: { assetId: string; active: boolean };
}

interface ManifestAsset {
  id: string;
  dataURL: string;
}

interface Manifest {
  uuid: string;
  terrain: ManifestAsset[];
  structures: ManifestAsset[];
  objects: ManifestAsset[];
}

interface ProductAsset extends CatalogAsset {
  itemId: string;
}

interface TmjProperty {
  name: string;
  type: string;
  value: string | number | boolean;
}

interface TmjObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  gid?: number;
  polygon?: Point[];
  rotation?: number;
  visible?: boolean;
  properties?: TmjProperty[];
}

interface TmjTileset {
  firstgid: number;
  columns: number;
  image: string;
  imagewidth: number;
  imageheight: number;
  margin: number;
  name: string;
  spacing: number;
  tilecount: number;
  tileheight: number;
  tilewidth: number;
  type: 'tileset';
  version: string;
}

interface TmjLayer {
  id: number;
  name: string;
  type: 'tilelayer' | 'objectgroup';
  visible: boolean;
  opacity: number;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  startx?: number;
  starty?: number;
  data?: number[];
  draworder?: 'topdown';
  objects?: TmjObject[];
}

interface TmjMap {
  compressionlevel: number;
  height: number;
  width: number;
  infinite: boolean;
  orientation: 'orthogonal';
  renderorder: 'right-down';
  tiledversion: string;
  type: 'map';
  version: string;
  tilewidth: number;
  tileheight: number;
  nextlayerid: number;
  nextobjectid: number;
  tilesets: TmjTileset[];
  layers: TmjLayer[];
  properties: TmjProperty[];
}

interface ObjectPlacement {
  name: string;
  assetId: string;
  tileX: number;
  tileY: number;
}

interface BuildContext {
  office: OfficePreset;
  assets: Map<string, ProductAsset>;
  firstGids: Map<string, number>;
  collision: number[];
  width: number;
  height: number;
}

function parseJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function loadProductAssets(): { catalog: Catalog; assets: Map<string, ProductAsset> } {
  const catalog = parseJson<Catalog>(CATALOG_PATH);
  if (catalog.generation !== 'atelier-v1' || catalog.palette.packUuid !== PACK_UUID) {
    throw new Error('The active Atelier catalog does not match the standard-map generation.');
  }
  if (catalog.worldGrid.tileWidth !== TILE || catalog.worldGrid.tileHeight !== TILE) {
    throw new Error('The Atelier catalog must use the 16-pixel world grid.');
  }
  if (catalog.withheldAutotile.active) throw new Error('A28 forbids the wall autotile in this map generation.');

  const manifest = parseJson<Manifest>(resolve(REPO_ROOT, catalog.manifest));
  if (manifest.uuid !== PACK_UUID) throw new Error('The Atelier manifest has an unexpected pack UUID.');
  const manifestItems = [...manifest.terrain, ...manifest.structures, ...manifest.objects];
  const itemByUrl = new Map(manifestItems.map((item) => [item.dataURL, item.id]));
  const assets = new Map<string, ProductAsset>();
  for (const asset of catalog.environmentAssets) {
    const itemId = itemByUrl.get(asset.url);
    if (!itemId && asset.id === catalog.withheldAutotile.assetId && !catalog.withheldAutotile.active) continue;
    if (!itemId) throw new Error(`No product-manifest item matches catalog asset '${asset.id}'.`);
    assets.set(asset.id, { ...asset, itemId });
  }
  return { catalog, assets };
}

function assetOrThrow(assets: Map<string, ProductAsset>, id: string): ProductAsset {
  const asset = assets.get(id);
  if (!asset) throw new Error(`Unknown Atelier asset '${id}'.`);
  return asset;
}

function tileLayer(id: number, name: string, width: number, height: number, data: number[], visible = true): TmjLayer {
  return { id, name, type: 'tilelayer', visible, opacity: 1, width, height, x: 0, y: 0, startx: 0, starty: 0, data };
}

function objectLayer(id: number, name: string, objects: TmjObject[]): TmjLayer {
  return { id, name, type: 'objectgroup', visible: true, opacity: 1, draworder: 'topdown', objects };
}

function makeTileset(firstgid: number, asset: ProductAsset, tileWidth = asset.width, tileHeight = asset.height): TmjTileset {
  const columns = Math.max(1, Math.floor(asset.width / tileWidth));
  const rows = Math.max(1, Math.floor(asset.height / tileHeight));
  return {
    firstgid,
    columns,
    image: asset.url,
    imagewidth: asset.width,
    imageheight: asset.height,
    margin: 0,
    name: `atelier_v1_${asset.id}`,
    spacing: 0,
    tilecount: columns * rows,
    tileheight: tileHeight,
    tilewidth: tileWidth,
    type: 'tileset',
    version: '1.10',
  };
}

function buildTilesets(catalog: Catalog, assets: Map<string, ProductAsset>, usedIds: Set<string>) {
  const floor = assetOrThrow(assets, catalog.floorAtlas.assetId);
  const carpet = assetOrThrow(assets, 'carpet');
  const tilesets = [makeTileset(1, floor, TILE, TILE), makeTileset(5, carpet, TILE, TILE)];
  const firstGids = new Map<string, number>([
    [floor.id, 1],
    [carpet.id, 5],
  ]);
  let firstgid = 6;
  for (const id of [...usedIds].filter((assetId) => assetId !== floor.id && assetId !== carpet.id).sort()) {
    const asset = assetOrThrow(assets, id);
    firstGids.set(id, firstgid);
    tilesets.push(makeTileset(firstgid, asset));
    firstgid++;
  }
  return { tilesets, firstGids };
}

function inRect(point: Point, rect: { x: number; y: number; w: number; h: number }): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h;
}

function buildGround(office: OfficePreset, firstGids: Map<string, number>): number[] {
  const width = office.world.width / TILE;
  const height = office.world.height / TILE;
  const floorFirstGid = firstGids.get('floor') ?? 1;
  const carpetGid = firstGids.get('carpet') ?? 5;
  const data: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const center = { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 };
      const threshold = y === (office.bounds.y + office.bounds.h) / TILE && x >= 29 && x <= 30;
      if (!inRect(center, office.bounds) && !threshold) {
        data.push(0);
        continue;
      }
      const carpeted = office.zones.some((zone) => zone.surface === 'carpet' && inRect(center, zone));
      const atlasIndex = (x % 2) + (y % 2) * 2;
      data.push(carpeted ? carpetGid : floorFirstGid + atlasIndex);
    }
  }
  return data;
}

function perimeterWalls(office: OfficePreset): ObjectPlacement[] {
  const left = office.bounds.x / TILE;
  const top = office.bounds.y / TILE;
  const right = (office.bounds.x + office.bounds.w) / TILE - 1;
  const bottom = (office.bounds.y + office.bounds.h) / TILE;
  const result: ObjectPlacement[] = [];
  const add = (x: number, collisionY: number) =>
    result.push({
      name: `loft-boundary-wall-${x}-${collisionY}`,
      assetId: 'wall',
      tileX: x,
      tileY: collisionY - 2,
    });
  for (let x = left; x <= right; x++) add(x, top - 1);
  for (let y = top; y < bottom; y++) {
    add(left - 1, y);
    add(right + 1, y);
  }
  for (let x = left; x <= right; x++) if (x < 29 || x > 30) add(x, bottom);
  return result;
}

function wallPlacements(office: OfficePreset): ObjectPlacement[] {
  const cells = new Set(office.walls.map((wall) => `${wall.x},${wall.y}`));
  return office.walls
    .filter((wall) => {
      const vertical = cells.has(`${wall.x},${wall.y - TILE}`) || cells.has(`${wall.x},${wall.y + TILE}`);
      const horizontal = cells.has(`${wall.x - TILE},${wall.y}`) || cells.has(`${wall.x + TILE},${wall.y}`);
      // The regular wall sprite has no horizontal joins. Horizontal-only runs
      // stay out of the production map until the A28 autotile follow-up.
      return vertical || !horizontal;
    })
    .map((wall) => ({
      name: `loft-wall-${wall.x / TILE}-${wall.y / TILE}`,
      assetId: 'wall',
      tileX: wall.x / TILE,
      tileY: wall.y / TILE - 2,
    }));
}

function studyPlacements(office: OfficePreset): ObjectPlacement[] {
  return office.placements.map((placement) => ({
    name: placement.id,
    assetId: placement.asset,
    tileX: placement.x / TILE,
    tileY: placement.y / TILE,
  }));
}

function markCollision(ctx: BuildContext, placement: ObjectPlacement): void {
  const asset = assetOrThrow(ctx.assets, placement.assetId);
  if (!asset.collide) return;
  const footprintW = Math.ceil(asset.width / TILE);
  const footprintH = Math.ceil(asset.height / TILE);
  const rows = asset.collisionBaseHeight > 0 ? Math.min(asset.collisionBaseHeight, footprintH) : footprintH;
  for (let dy = footprintH - rows; dy < footprintH; dy++) {
    for (let dx = 0; dx < footprintW; dx++) {
      const x = placement.tileX + dx;
      const y = placement.tileY + dy;
      if (x >= 0 && x < ctx.width && y >= 0 && y < ctx.height) ctx.collision[y * ctx.width + x] = 1;
    }
  }
}

function initializeCollision(office: OfficePreset, width: number, height: number): number[] {
  const collision = new Array<number>(width * height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const center = { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 };
      const threshold = y === (office.bounds.y + office.bounds.h) / TILE && x >= 29 && x <= 30;
      if (!inRect(center, office.bounds) && !threshold) collision[y * width + x] = 1;
    }
  }
  return collision;
}

function serializePlacement(id: number, placement: ObjectPlacement, ctx: BuildContext): TmjObject {
  const asset = assetOrThrow(ctx.assets, placement.assetId);
  const footprintW = Math.ceil(asset.width / TILE);
  const footprintH = Math.ceil(asset.height / TILE);
  const gid = ctx.firstGids.get(placement.assetId);
  if (!gid) throw new Error(`Missing tileset for '${placement.assetId}'.`);
  return {
    id,
    name: placement.name,
    type: asset.category,
    gid,
    x: placement.tileX * TILE,
    y: placement.tileY * TILE + asset.height,
    width: asset.width,
    height: asset.height,
    rotation: 0,
    visible: true,
    properties: [
      { name: 'assetPackUuid', type: 'string', value: PACK_UUID },
      { name: 'itemId', type: 'string', value: asset.itemId },
      { name: 'category', type: 'string', value: asset.category },
      { name: 'collide', type: 'bool', value: asset.collide },
      { name: 'tileX', type: 'int', value: placement.tileX },
      { name: 'tileY', type: 'int', value: placement.tileY },
      { name: 'footprintW', type: 'int', value: footprintW },
      { name: 'footprintH', type: 'int', value: footprintH },
      { name: 'collisionBaseHeight', type: 'int', value: asset.collisionBaseHeight },
      { name: 'renderLayer', type: 'string', value: asset.renderLayer },
    ],
  };
}

function isWalkable(ctx: BuildContext, point: Point): boolean {
  const x = Math.floor(point.x / TILE);
  const y = Math.floor(point.y / TILE);
  return x >= 0 && x < ctx.width && y >= 0 && y < ctx.height && ctx.collision[y * ctx.width + x] === 0;
}

function zonePolygon(zone: OfficeZone, ctx: BuildContext): Point[] {
  const inset = TILE / 2;
  const corners = [
    { x: zone.x + inset, y: zone.y + inset },
    { x: zone.x + zone.w - inset, y: zone.y + inset },
    { x: zone.x + zone.w - inset, y: zone.y + zone.h - inset },
    { x: zone.x + inset, y: zone.y + zone.h - inset },
  ];
  const candidates = corners
    .map((point, index) => ({ point, index, distance: Math.hypot(point.x - zone.entry.x, point.y - zone.entry.y) }))
    .filter(({ point }) => isWalkable(ctx, point))
    .sort((a, b) => a.distance - b.distance);
  const start = candidates[0];
  if (!start) throw new Error(`Zone '${zone.name}' has no walkable polygon start.`);
  return [...corners.slice(start.index), ...corners.slice(0, start.index)];
}

function zoneCapacity(zone: OfficeZone): number | undefined {
  if (zone.kind === 'work') return 4;
  if (zone.kind === 'focus') return 2;
  if (zone.kind === 'meeting') return 4;
  return undefined;
}

function serializeZones(office: OfficePreset, ctx: BuildContext, firstId: number): TmjObject[] {
  return office.zones
    .filter((zone) => zone.kind !== 'arrival')
    .map((zone, index) => {
      const absolute = zonePolygon(zone, ctx);
      const origin = absolute[0];
      const capacity = zoneCapacity(zone);
      return {
        id: firstId + index,
        name: zone.name,
        type: 'zone',
        x: origin.x,
        y: origin.y,
        width: 0,
        height: 0,
        polygon: absolute.map((point) => ({ x: point.x - origin.x, y: point.y - origin.y })),
        properties: [
          { name: 'kind', type: 'string', value: zone.kind },
          { name: 'detail', type: 'string', value: zone.detail },
          ...(capacity === undefined ? [] : [{ name: 'capacity', type: 'int', value: capacity }]),
        ],
      };
    });
}

function serializeWorkplaces(office: OfficePreset, firstId: number): TmjObject[] {
  return office.workplaces.map((workplace, index) => ({
    id: firstId + index,
    name: workplace.id,
    type: 'workplace',
    x: workplace.approach.x,
    y: workplace.approach.y,
    width: 0,
    height: 0,
  }));
}

export function buildAtelierStandardMap(): TmjMap {
  const office = officePresets.loft;
  const width = office.world.width / TILE;
  const height = office.world.height / TILE;
  const { catalog, assets } = loadProductAssets();
  const placements = [...perimeterWalls(office), ...wallPlacements(office), ...studyPlacements(office)];
  const usedIds = new Set(placements.map((placement) => placement.assetId));
  usedIds.add('floor');
  usedIds.add('carpet');
  const { tilesets, firstGids } = buildTilesets(catalog, assets, usedIds);
  const ctx: BuildContext = { office, assets, firstGids, collision: initializeCollision(office, width, height), width, height };
  placements.forEach((placement) => markCollision(ctx, placement));

  let nextObjectId = 1;
  const serialized = placements.map((placement) => serializePlacement(nextObjectId++, placement, ctx));
  const structures = serialized.filter((object) => object.type === 'structures' && propertyValue(object, 'renderLayer') !== 'overhead');
  const decor = serialized.filter((object) => propertyValue(object, 'renderLayer') === 'overhead');
  const furniture = serialized.filter((object) => object.type === 'objects' && propertyValue(object, 'renderLayer') !== 'overhead');
  const zones = serializeZones(office, ctx, nextObjectId);
  nextObjectId += zones.length;
  const workplaces = serializeWorkplaces(office, nextObjectId);
  nextObjectId += workplaces.length;
  const spawn: TmjObject = {
    id: nextObjectId++,
    name: 'spawn',
    type: 'spawn',
    x: office.spawn.x,
    y: office.spawn.y,
    width: 0,
    height: 0,
  };

  return {
    compressionlevel: -1,
    height,
    width,
    infinite: false,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.10.2',
    type: 'map',
    version: '1.10',
    tilewidth: TILE,
    tileheight: TILE,
    nextlayerid: 9,
    nextobjectid: nextObjectId,
    tilesets,
    layers: [
      tileLayer(1, 'Ground', width, height, buildGround(office, firstGids)),
      objectLayer(2, 'Structures', structures),
      objectLayer(3, 'Furniture', furniture),
      objectLayer(4, 'Decor', decor),
      tileLayer(5, 'Collision', width, height, ctx.collision, false),
      objectLayer(6, 'Zones', zones),
      objectLayer(7, 'Workplaces', workplaces),
      objectLayer(8, 'Points', [spawn]),
    ],
    properties: [
      { name: 'spawnX', type: 'int', value: office.spawn.x },
      { name: 'spawnY', type: 'int', value: office.spawn.y },
      { name: 'source', type: 'string', value: 'meetropolis-office-study/v2:loft' },
      { name: 'generation', type: 'string', value: 'atelier-v1' },
    ],
  };
}

function propertyValue(object: TmjObject, name: string): string | number | boolean | undefined {
  return object.properties?.find((property) => property.name === name)?.value;
}

export function writeAtelierStandardMap(path = OUTPUT_PATH): void {
  const tmj = buildAtelierStandardMap();
  writeFileSync(path, `${JSON.stringify(tmj, null, 2)}\n`, 'utf8');
  console.log(`[build] wrote ${path}`);
  console.log(`[build] ${tmj.width}x${tmj.height} tiles, ${tmj.tilesets.length} tilesets, ${tmj.nextobjectid - 1} objects`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) writeAtelierStandardMap();
