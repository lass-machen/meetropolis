import type express from 'express';
import { Prisma, type MapAutotile, type PrismaClient } from '../../generated/prisma/index.js';
import { assetPackScopeWhere } from '../../services/packScope.js';
import { StoredAutotileItemSchema } from '../routes/assetPacks.schemas.js';
import { resolvePackScope } from './resolvePackScope.js';

export interface AutotileIdentity {
  packUuid: string;
  autotileId: string;
}

export interface MapAutotileRegistration {
  slot: number;
  packUuid: string;
  autotileId: string;
  key: string;
  imageUrl: string;
  tileWidth: number;
  tileHeight: number;
  gridHeight: number;
  variants: Prisma.JsonValue;
  collide: boolean;
  placement: string;
  hash: string | null;
}

interface AutotileSnapshot extends Omit<MapAutotileRegistration, 'slot' | 'packUuid' | 'autotileId' | 'variants'> {
  variants: Prisma.InputJsonValue;
}

export type PaletteAllocation = { entry: MapAutotile; created: boolean };

const ALLOCATION_ATTEMPTS = 5;

export function mapAutotileRegistration(entry: MapAutotile): MapAutotileRegistration {
  return {
    slot: entry.slot,
    packUuid: entry.packUuid,
    autotileId: entry.autotileId,
    key: entry.key,
    imageUrl: entry.imageUrl,
    tileWidth: entry.tileWidth,
    tileHeight: entry.tileHeight,
    gridHeight: entry.gridHeight,
    variants: entry.variants,
    collide: entry.collide,
    placement: entry.placement,
    hash: entry.hash,
  };
}

function isRetryableAllocationError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === 'P2002' || error.code === 'P2034';
}

export async function allocateMapAutotile(
  prisma: PrismaClient,
  mapId: string,
  identity: AutotileIdentity,
  snapshot: AutotileSnapshot,
): Promise<PaletteAllocation> {
  for (let attempt = 0; attempt < ALLOCATION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.mapAutotile.findUnique({
            where: { mapId_packUuid_autotileId: { mapId, ...identity } },
          });
          if (existing) return { entry: existing, created: false };

          const map = await tx.map.update({
            where: { id: mapId },
            data: { nextAutotileSlot: { increment: 1 } },
            select: { nextAutotileSlot: true },
          });
          const slot = map.nextAutotileSlot - 1;
          const entry = await tx.mapAutotile.create({
            data: { mapId, slot, ...identity, ...snapshot },
          });
          return { entry, created: true };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (!isRetryableAllocationError(error) || attempt === ALLOCATION_ATTEMPTS - 1) throw error;
    }
  }
  throw new Error('autotile_palette_allocation_exhausted');
}

export async function resolveMapAutotileForPaint(
  prisma: PrismaClient,
  req: express.Request,
  mapId: string,
  identity: AutotileIdentity,
): Promise<PaletteAllocation | null> {
  const scope = await resolvePackScope(prisma, req);
  const pack = await prisma.assetPack.findFirst({
    where: { uuid: identity.packUuid, archived: false, ...assetPackScopeWhere(scope) },
    select: { autotiles: true },
  });
  if (!pack || !Array.isArray(pack.autotiles)) return null;

  const source = pack.autotiles.find(
    (value) => typeof value === 'object' && value !== null && 'id' in value && value.id === identity.autotileId,
  );
  const parsed = StoredAutotileItemSchema.safeParse(source);
  if (!parsed.success) return null;
  const item = parsed.data;
  return allocateMapAutotile(prisma, mapId, identity, {
    key: item.key,
    imageUrl: item.dataURL,
    tileWidth: item.tileWidth,
    tileHeight: item.tileHeight,
    gridHeight: item.gridHeight,
    variants: item.variants,
    collide: item.collide,
    placement: item.placement,
    hash: null,
  });
}
