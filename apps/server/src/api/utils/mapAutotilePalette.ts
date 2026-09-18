import type express from 'express';
import { Prisma, type MapAutotile, type PrismaClient } from '../../generated/prisma/index.js';
import { assetPackScopeWhere } from '../../services/packScope.js';
import { StoredAutotileItemSchema } from '../routes/assetPacks.schemas.js';
import { resolvePackScope } from './resolvePackScope.js';
import { runSerializable, type MapDb } from './mapChunkMutations.js';
import { acquirePackAdvisoryLock } from './packAdvisoryLock.js';

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

export interface AutotileSnapshot extends Omit<
  MapAutotileRegistration,
  'slot' | 'packUuid' | 'autotileId' | 'variants'
> {
  variants: Prisma.InputJsonValue;
}

export type PaletteAllocation = { entry: MapAutotile; created: boolean };

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

export function contentHashFromAssetUrl(url: string): string | null {
  const filename = url.split(/[?#]/, 1)[0].split('/').pop() ?? '';
  return filename.match(/\.([0-9a-f]{8,64})\.[^.]+$/i)?.[1]?.toLowerCase() ?? null;
}

function snapshotFromStoredAutotiles(autotiles: Prisma.JsonValue, autotileId: string): AutotileSnapshot | null {
  if (!Array.isArray(autotiles)) return null;
  const source = autotiles.find(
    (value) => typeof value === 'object' && value !== null && 'id' in value && value.id === autotileId,
  );
  const parsed = StoredAutotileItemSchema.safeParse(source);
  if (!parsed.success) return null;
  const item = parsed.data;
  return {
    key: item.key,
    imageUrl: item.dataURL,
    tileWidth: item.tileWidth,
    tileHeight: item.tileHeight,
    gridHeight: item.gridHeight,
    variants: item.variants,
    collide: item.collide,
    placement: item.placement,
    hash: contentHashFromAssetUrl(item.dataURL),
  };
}

export async function allocateMapAutotileInTransaction(
  tx: MapDb,
  mapId: string,
  identity: AutotileIdentity,
  _snapshot: AutotileSnapshot,
): Promise<PaletteAllocation> {
  let existing = await tx.mapAutotile.findUnique({
    where: { mapId_packUuid_autotileId: { mapId, ...identity } },
  });
  if (existing) return { entry: existing, created: false };

  await acquirePackAdvisoryLock(tx, identity.packUuid);
  existing = await tx.mapAutotile.findUnique({
    where: { mapId_packUuid_autotileId: { mapId, ...identity } },
  });
  if (existing) return { entry: existing, created: false };
  const pack = await tx.assetPack.findUnique({
    where: { uuid: identity.packUuid },
    select: { archived: true, autotiles: true },
  });
  const snapshot = pack && !pack.archived ? snapshotFromStoredAutotiles(pack.autotiles, identity.autotileId) : null;
  if (!snapshot) throw new Error('autotile_not_found');

  const [map, maximum] = await Promise.all([
    tx.map.findUnique({ where: { id: mapId }, select: { nextAutotileSlot: true } }),
    tx.mapAutotile.aggregate({ where: { mapId }, _max: { slot: true } }),
  ]);
  if (!map) throw new Error('map_not_found');
  const slot = Math.max(map.nextAutotileSlot, (maximum._max.slot ?? 0) + 1);
  const entry = await tx.mapAutotile.create({ data: { mapId, slot, ...identity, ...snapshot } });
  await tx.map.update({ where: { id: mapId }, data: { nextAutotileSlot: slot + 1 } });
  return { entry, created: true };
}

export function allocateMapAutotile(
  prisma: PrismaClient,
  mapId: string,
  identity: AutotileIdentity,
  snapshot: AutotileSnapshot,
): Promise<PaletteAllocation> {
  return runSerializable(prisma, (tx) => allocateMapAutotileInTransaction(tx, mapId, identity, snapshot));
}

export async function resolveMapAutotileSnapshotForPaint(
  prisma: PrismaClient,
  req: express.Request,
  identity: AutotileIdentity,
): Promise<AutotileSnapshot | null> {
  const scope = await resolvePackScope(prisma, req);
  const pack = await prisma.assetPack.findFirst({
    where: { uuid: identity.packUuid, archived: false, ...assetPackScopeWhere(scope) },
    select: { autotiles: true },
  });
  return pack ? snapshotFromStoredAutotiles(pack.autotiles, identity.autotileId) : null;
}

export async function resolveMapAutotileForPaint(
  prisma: PrismaClient,
  req: express.Request,
  mapId: string,
  identity: AutotileIdentity,
): Promise<PaletteAllocation | null> {
  const snapshot = await resolveMapAutotileSnapshotForPaint(prisma, req, identity);
  return snapshot ? allocateMapAutotile(prisma, mapId, identity, snapshot) : null;
}
