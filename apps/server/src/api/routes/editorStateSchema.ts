import { z } from 'zod';

export const MAX_EDITOR_TILESETS = 256;
export const MAX_EDITOR_ZONES = 512;

const DATA_URL_MAX_CHARS = 4 * 1024 * 1024;
const MIN_POLYGON_POINTS = 3;
const MAX_POLYGON_POINTS = 2048;
const MAX_NAME_CHARS = 256;
const MAX_TILE_PX = 1024;
const MAX_ZONE_CAPACITY = 10000;

const finiteNumber = z.number().finite();

const pointSchema = z
  .object({
    x: finiteNumber,
    y: finiteNumber,
  })
  .strict();

const pointListSchema = z.array(pointSchema).min(MIN_POLYGON_POINTS).max(MAX_POLYGON_POINTS);

const polygonSchema = z.union([pointListSchema, z.object({ points: pointListSchema }).strict()]);

export const editorTilesetSchema = z.object({
  key: z.string().min(1).max(MAX_NAME_CHARS),
  dataUrl: z.string().min(1).max(DATA_URL_MAX_CHARS),
  tileWidth: z.number().int().min(1).max(MAX_TILE_PX),
  tileHeight: z.number().int().min(1).max(MAX_TILE_PX),
  margin: z.number().int().min(0).max(MAX_TILE_PX).optional(),
  spacing: z.number().int().min(0).max(MAX_TILE_PX).optional(),
  category: z.string().max(MAX_NAME_CHARS).optional(),
});

/** Name a zone gets when the editor sends none; the route stored it before the schema existed. */
export const DEFAULT_ZONE_NAME = 'Zone';

// Released editors let a zone name be cleared, and the route used to store a
// zone without a name as DEFAULT_ZONE_NAME. A missing, null or blank name keeps
// that behaviour instead of failing the whole save; every other rule stays.
const zoneNameSchema = z.preprocess(
  (value) =>
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
      ? DEFAULT_ZONE_NAME
      : value,
  z.string().min(1).max(MAX_NAME_CHARS),
);

export const editorZoneSchema = z.object({
  id: z.string().max(MAX_NAME_CHARS).optional(),
  name: zoneNameSchema,
  type: z.enum(['default', 'portal']).nullable().optional(),
  points: pointListSchema.optional(),
  polygon: polygonSchema.nullable().optional(),
  capacity: z.number().int().min(0).max(MAX_ZONE_CAPACITY).nullable().optional(),
  portalTarget: z.string().max(MAX_NAME_CHARS).nullable().optional(),
  portalSpawnX: finiteNumber.nullable().optional(),
  portalSpawnY: finiteNumber.nullable().optional(),
});

const spawnSchema = z.object({
  x: finiteNumber,
  y: finiteNumber,
});

// replaceZones is the existing clear-and-replace flag on the editor-state route.
export const editorStateSchema = z
  .object({
    tilesets: z.array(editorTilesetSchema).max(MAX_EDITOR_TILESETS).optional(),
    zones: z.array(editorZoneSchema).max(MAX_EDITOR_ZONES).optional(),
    backgroundColor: z
      .string()
      .regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
      .optional(),
    replaceZones: z.boolean().optional(),
    spawn: spawnSchema.optional(),
  });
