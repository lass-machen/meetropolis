import { z } from 'zod';
import crypto from 'crypto';
import path from 'path';

// Zod Schemas according to ASSET_PACKS_SPEC.md
const idStr = z.string().min(1).max(200);
const relPath = z
  .string()
  .min(1)
  .regex(/^assets\/[A-Za-z0-9_\-\/.]+$/);

const DirectionalImage = z
  .object({
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
    dataURL: relPath,
  })
  .strict();

const BaseItem = z
  .object({
    id: idStr,
    key: z.string().min(1).max(200),
    category: z.enum(['terrain', 'structure', 'objects']),
    dataURL: relPath,
    collide: z.boolean().default(false),
    placement: z.enum(['any', 'floor', 'wall']).default('any'),
    anchor: z.object({ x: z.number(), y: z.number() }).partial().optional(),
    offset: z.object({ x: z.number(), y: z.number() }).partial().optional(),
    zIndex: z.number().int().optional(),
    rotationAllowed: z.boolean().optional(),
    flipAllowed: z.boolean().optional(),
    scaleFactor: z.number().positive().optional(),
    // Depth-layering (Strang B/C): the object type's default collision foot and
    // render band, carried on the pack item so the editor injects them when
    // placing (the same defaults the map generator bakes into office.json).
    collisionBaseHeight: z.number().int().nonnegative().optional(),
    renderLayer: z.enum(['floor', 'sorted', 'overhead']).optional(),
  })
  .strict();

const TerrainItem = BaseItem.extend({
  category: z.literal('terrain'),
  tileWidth: z.number().int().positive(),
  tileHeight: z.number().int().positive(),
  margin: z.number().int().nonnegative().default(0),
  spacing: z.number().int().nonnegative().default(0),
}).strict();

const SpriteItem = BaseItem.extend({
  category: z.enum(['structure', 'objects']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  directionalImages: z.array(DirectionalImage).max(4).optional(),
}).strict();

const AutotileVariant = z
  .object({
    col: z.number().int().nonnegative(),
    row: z.number().int().nonnegative(),
  })
  .strict();

const AutotileItem = z
  .object({
    id: idStr,
    key: z.string().min(1).max(200),
    category: z.literal('autotile'),
    dataURL: relPath,
    placement: z.enum(['any', 'floor', 'wall']).default('wall'),
    collide: z.boolean().default(true),
    tileWidth: z.number().int().positive(),
    tileHeight: z.number().int().positive(),
    gridHeight: z.number().int().positive().default(1),
    autotileType: z.enum(['4bit', '8bit']).default('4bit'),
    variants: z.record(z.string(), AutotileVariant),
    scaleFactor: z.number().positive().optional(),
  })
  .strict();

export const ConfigSchema = z
  .object({
    uuid: z.string().uuid(),
    name: z.string().min(1),
    description: z.string().min(1),
    author: z.string().min(1),
    version: z.string().min(1),
    terrain: z.array(TerrainItem).default([]),
    structures: z.array(SpriteItem).default([]),
    objects: z.array(SpriteItem).default([]),
    autotiles: z.array(AutotileItem).default([]),
  })
  .strict();

// Helper functions
export function normalizeZipPath(p: string): string {
  const s = p.replace(/\\/g, '/');
  return path.posix.normalize(s);
}

export function isUnsafePath(p: string): boolean {
  if (p.startsWith('/') || p.startsWith('\\')) return true;
  if (p.includes('..')) return true;
  if (p.includes(':')) return true;
  return false;
}

export function isAllowedAssetExt(p: string): boolean {
  const ext = path.extname(p).toLowerCase();
  return ext === '.png' || ext === '.webp';
}

export function shortHashHex(buf: Buffer, len = 8): string {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, len);
}

export function withoutAssetsPrefix(p: string): string {
  return p.replace(/^assets\//, '');
}
