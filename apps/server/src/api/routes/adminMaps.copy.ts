import { PrismaClient, Prisma } from '../../generated/prisma/index.js';
import { assetPackScopeWhere, resolveTenantPackScope } from '../../services/packScope.js';

type TxClient = Prisma.TransactionClient;

export class TargetPackAccessError extends Error {
  constructor(readonly packUuids: readonly string[]) {
    super(`target_tenant_cannot_access_asset_packs:${packUuids.join(',')}`);
    this.name = 'TargetPackAccessError';
  }
}

type OriginalMapWithRelations = Prisma.MapGetPayload<{
  include: {
    tilesets: { orderBy: { slot: 'asc' } };
    layers: { include: { chunks: true } };
    objects: true;
    rooms: { include: { zones: true } };
  };
}>;

async function resolveCopyName(prisma: PrismaClient, targetTenantId: string, baseName: string): Promise<string> {
  let copyName = baseName;
  let suffix = 1;
  while (await prisma.map.findUnique({ where: { tenantId_name: { tenantId: targetTenantId, name: copyName } } })) {
    suffix++;
    copyName = `${baseName}-${suffix}`;
  }
  return copyName;
}

async function copyTilesets(tx: TxClient, original: OriginalMapWithRelations, newMapId: string): Promise<void> {
  for (const ts of original.tilesets) {
    await tx.mapTileset.create({
      data: {
        mapId: newMapId,
        slot: ts.slot,
        key: ts.key,
        imageUrl: ts.imageUrl,
        tileWidth: ts.tileWidth,
        tileHeight: ts.tileHeight,
        margin: ts.margin,
        spacing: ts.spacing,
        hash: ts.hash,
        tileCount: ts.tileCount,
      },
    });
  }
}

async function copyLayersAndChunks(tx: TxClient, original: OriginalMapWithRelations, newMapId: string): Promise<void> {
  for (const layer of original.layers) {
    const newLayer = await tx.mapLayer.create({
      data: { mapId: newMapId, name: layer.name, chunkSize: layer.chunkSize },
    });
    for (const chunk of layer.chunks) {
      await tx.mapChunk.create({
        data: {
          layerId: newLayer.id,
          x: chunk.x,
          y: chunk.y,
          version: chunk.version,
          encoding: chunk.encoding,
          data: chunk.data,
        },
      });
    }
  }
}

/**
 * Copy every placed object.
 *
 * EVERY non-generated column of `MapObject` must be listed here. An omitted
 * column does not copy "unchanged" — Prisma silently applies the schema
 * default, so the copy differs from its source in a way nothing reports. That
 * is how `collisionBaseHeight` and `renderLayer` (the depth-layering pair) were
 * lost: the template map's wall art and whiteboards arrived at every new tenant
 * as `renderLayer='sorted'` and rendered BEHIND avatars, and plants blocked
 * their whole footprint instead of just the pot.
 *
 * When a column is added to `MapObject`, add it here in the same commit.
 */
async function copyObjects(tx: TxClient, original: OriginalMapWithRelations, newMapId: string): Promise<void> {
  for (const obj of original.objects) {
    await tx.mapObject.create({
      data: {
        mapId: newMapId,
        assetPackUuid: obj.assetPackUuid,
        itemId: obj.itemId,
        category: obj.category,
        tileX: obj.tileX,
        tileY: obj.tileY,
        chunkX: obj.chunkX,
        chunkY: obj.chunkY,
        width: obj.width,
        height: obj.height,
        collide: obj.collide,
        zIndex: obj.zIndex,
        rotation: obj.rotation,
        flipX: obj.flipX,
        flipY: obj.flipY,
        scaleFactor: obj.scaleFactor,
        dataUrl: obj.dataUrl,
        collisionBaseHeight: obj.collisionBaseHeight,
        renderLayer: obj.renderLayer,
      },
    });
  }
}

async function copyRoomsAndZones(
  tx: TxClient,
  original: OriginalMapWithRelations,
  newMapId: string,
  targetTenantId: string,
): Promise<void> {
  for (const room of original.rooms) {
    const newRoom = await tx.room.create({
      data: { name: room.name, tenantId: targetTenantId, mapId: newMapId },
    });
    for (const zone of room.zones) {
      await tx.zone.create({
        data: {
          name: zone.name,
          capacity: zone.capacity,
          polygon: zone.polygon as Prisma.InputJsonValue,
          type: zone.type,
          portalTarget: zone.portalTarget,
          portalSpawnX: zone.portalSpawnX,
          portalSpawnY: zone.portalSpawnY,
          roomId: newRoom.id,
          mapId: newMapId,
          tenantId: targetTenantId,
        },
      });
    }
  }
}

async function assertTargetPackAccess(
  prisma: PrismaClient,
  original: OriginalMapWithRelations,
  targetTenantId: string,
): Promise<void> {
  const referencedUuids = [...new Set(original.objects.map((object) => object.assetPackUuid))];
  if (referencedUuids.length === 0) return;
  const scope = await resolveTenantPackScope(prisma, targetTenantId, 'asset');
  const accessible = await prisma.assetPack.findMany({
    where: { uuid: { in: referencedUuids }, ...assetPackScopeWhere(scope) },
    select: { uuid: true },
  });
  const accessibleUuids = new Set(accessible.map((pack) => pack.uuid));
  const registered = await prisma.assetPack.findMany({
    where: { uuid: { in: referencedUuids } },
    select: { uuid: true },
  });
  const registeredUuids = new Set(registered.map((pack) => pack.uuid));

  // Import paths currently persist invented pseudo-UUIDs for self-contained
  // objects. That modelling defect will be fixed separately. Until then, a
  // missing AssetPack cannot grant access and must not make the map uncopyable;
  // only a registered pack outside the target tenant's scope is forbidden.
  const blockedUuids = referencedUuids.filter((uuid) => registeredUuids.has(uuid) && !accessibleUuids.has(uuid));
  if (blockedUuids.length > 0) {
    throw new TargetPackAccessError(blockedUuids);
  }
}

/**
 * Deep-copy a map (with all tilesets, layers, chunks, objects, rooms, zones)
 * to a target tenant. Resolves name collisions by appending `-2`, `-3`, etc.
 */
export async function copyMapToTenant(
  prisma: PrismaClient,
  sourceMapId: string,
  targetTenantId: string,
  newName?: string,
): Promise<{ id: string; name: string }> {
  const original = await prisma.map.findUnique({
    where: { id: sourceMapId },
    include: {
      tilesets: { orderBy: { slot: 'asc' } },
      layers: { include: { chunks: true } },
      objects: true,
      rooms: { include: { zones: true } },
    },
  });
  if (!original) throw new Error('source_map_not_found');

  await assertTargetPackAccess(prisma, original, targetTenantId);

  const baseName = newName || `${original.name}-copy`;
  const copyName = await resolveCopyName(prisma, targetTenantId, baseName);

  const result = await prisma.$transaction(async (tx) => {
    const newMap = await tx.map.create({
      data: {
        tenantId: targetTenantId,
        name: copyName,
        width: original.width,
        height: original.height,
        tileWidth: original.tileWidth,
        tileHeight: original.tileHeight,
        chunkSize: original.chunkSize,
        meta: original.meta as Prisma.InputJsonValue,
      },
    });

    await copyTilesets(tx, original, newMap.id);
    await copyLayersAndChunks(tx, original, newMap.id);
    await copyObjects(tx, original, newMap.id);
    await copyRoomsAndZones(tx, original, newMap.id, targetTenantId);

    return newMap;
  });

  return { id: result.id, name: result.name };
}
