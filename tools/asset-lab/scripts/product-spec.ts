import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assetDefinitions, themes, type AssetId, type ThemeId } from '../src/assets.ts';
import { parseCharacter, type Character } from '../src/avatar.ts';

const PRODUCT_SPEC_PATH = fileURLToPath(new URL('../product/atelier-v1.json', import.meta.url));
const DEFAULT_AVATAR_KEYS = [
  'business_man',
  'business_woman',
  'casual_woman',
  'dev_hoodie',
  'manager_woman',
  'suit_man',
] as const;

export interface Point {
  x: number;
  y: number;
}

export interface ProductAvatar {
  key: string;
  displayName: string;
  look: string;
  recipe: Character;
}

export interface ProductSpec {
  schema: string;
  generation: string;
  active: false;
  palette: { theme: ThemeId; slug: string; name: string; packUuid: string; packVersion: string };
  atelierOnlyThemes: ThemeId[];
  worldGrid: { tileWidth: number; tileHeight: number };
  floorAtlas: { assetId: AssetId; tileWidth: number; tileHeight: number; columns: number; rows: number };
  directionalStrategy: 'separate-items';
  overheadAssets: AssetId[];
  wallPlacement: { assetIds: AssetId[]; gridHeight: number; anchor: Point; offset: Point };
  autotile: {
    assetId: AssetId;
    active: false;
    blockedBy: string;
    tileWidth: number;
    tileHeight: number;
    gridHeight: number;
  };
  avatars: ProductAvatar[];
}

type JsonObject = Record<string, unknown>;

function record(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a string.`);
  return value;
}

function slug(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(parsed)) throw new Error(`${label} is invalid.`);
  return parsed;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${label} must be a positive integer.`);
  return Number(value);
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer.`);
  return Number(value);
}

function point(value: unknown, label: string): Point {
  const parsed = record(value, label);
  return { x: integer(parsed.x, `${label}.x`), y: integer(parsed.y, `${label}.y`) };
}

function themeId(value: unknown, label: string): ThemeId {
  const parsed = string(value, label);
  if (!Object.hasOwn(themes, parsed)) throw new Error(`${label} is unknown.`);
  return parsed as ThemeId;
}

function assetId(value: unknown, label: string): AssetId {
  const parsed = string(value, label);
  if (!Object.hasOwn(assetDefinitions, parsed)) throw new Error(`${label} is unknown.`);
  return parsed as AssetId;
}

function assetIds(value: unknown, label: string): AssetId[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((entry, index) => assetId(entry, `${label}[${index}]`));
}

function avatars(value: unknown): ProductAvatar[] {
  if (!Array.isArray(value) || value.length !== DEFAULT_AVATAR_KEYS.length)
    throw new Error('Exactly six default avatars are required.');
  return value.map((raw, index) => {
    const entry = record(raw, `avatars[${index}]`);
    const key = string(entry.key, `avatars[${index}].key`);
    if (key !== DEFAULT_AVATAR_KEYS[index]) throw new Error('Default avatar keys or their order changed.');
    return {
      key,
      displayName: string(entry.displayName, `avatars[${index}].displayName`),
      look: string(entry.look, `avatars[${index}].look`),
      recipe: parseCharacter(entry.recipe),
    };
  });
}

function parseProductSpec(value: unknown): ProductSpec {
  const spec = record(value, 'Product specification');
  if (spec.schema !== 'meetropolis-product-generation/v1' || spec.active !== false)
    throw new Error('The product generation must use schema v1 and remain inactive.');
  const palette = record(spec.palette, 'palette');
  const grid = record(spec.worldGrid, 'worldGrid');
  const floor = record(spec.floorAtlas, 'floorAtlas');
  const wall = record(spec.wallPlacement, 'wallPlacement');
  const autotile = record(spec.autotile, 'autotile');
  if (spec.directionalStrategy !== 'separate-items') throw new Error('Unsupported directional strategy.');
  if (autotile.active !== false) throw new Error('The product autotile must remain inactive.');
  return {
    schema: spec.schema,
    generation: slug(spec.generation, 'generation'),
    active: false,
    palette: {
      theme: themeId(palette.theme, 'palette.theme'),
      slug: slug(palette.slug, 'palette.slug'),
      name: string(palette.name, 'palette.name'),
      packUuid: string(palette.packUuid, 'palette.packUuid'),
      packVersion: string(palette.packVersion, 'palette.packVersion'),
    },
    atelierOnlyThemes: Array.isArray(spec.atelierOnlyThemes)
      ? spec.atelierOnlyThemes.map((entry, index) => themeId(entry, `atelierOnlyThemes[${index}]`))
      : [],
    worldGrid: {
      tileWidth: positiveInteger(grid.tileWidth, 'worldGrid.tileWidth'),
      tileHeight: positiveInteger(grid.tileHeight, 'worldGrid.tileHeight'),
    },
    floorAtlas: {
      assetId: assetId(floor.assetId, 'floorAtlas.assetId'),
      tileWidth: positiveInteger(floor.tileWidth, 'floorAtlas.tileWidth'),
      tileHeight: positiveInteger(floor.tileHeight, 'floorAtlas.tileHeight'),
      columns: positiveInteger(floor.columns, 'floorAtlas.columns'),
      rows: positiveInteger(floor.rows, 'floorAtlas.rows'),
    },
    directionalStrategy: spec.directionalStrategy,
    overheadAssets: assetIds(spec.overheadAssets, 'overheadAssets'),
    wallPlacement: {
      assetIds: assetIds(wall.assetIds, 'wallPlacement.assetIds'),
      gridHeight: positiveInteger(wall.gridHeight, 'wallPlacement.gridHeight'),
      anchor: point(wall.anchor, 'wallPlacement.anchor'),
      offset: point(wall.offset, 'wallPlacement.offset'),
    },
    autotile: {
      assetId: assetId(autotile.assetId, 'autotile.assetId'),
      active: false,
      blockedBy: string(autotile.blockedBy, 'autotile.blockedBy'),
      tileWidth: positiveInteger(autotile.tileWidth, 'autotile.tileWidth'),
      tileHeight: positiveInteger(autotile.tileHeight, 'autotile.tileHeight'),
      gridHeight: positiveInteger(autotile.gridHeight, 'autotile.gridHeight'),
    },
    avatars: avatars(spec.avatars),
  };
}

export async function loadProductSpec(): Promise<ProductSpec> {
  return parseProductSpec(JSON.parse(await readFile(PRODUCT_SPEC_PATH, 'utf8')));
}
