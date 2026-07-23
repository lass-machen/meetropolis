import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq, requireMembership } from '../utils/authHelpers.js';
import { pathParam } from '../utils/requestHelpers.js';

export function findMapById(prisma: PrismaClient, mapId: string, tenantId: string) {
  return prisma.map.findFirst({ where: { id: mapId, tenantId } });
}

/**
 * Auth + tenant + membership gate for tenant-scoped map reads.
 *
 * Tenant resolution (tenancy.ts) lets the client-supplied X-Tenant header take
 * precedence over the session JWT, so an authenticated user can aim req.tenant
 * at ANY tenant. Without a membership check a read endpoint discloses a foreign
 * tenant's data (handleListMaps additionally had no auth at all). Returns the
 * resolved tenant only when the caller holds a membership in it; otherwise it
 * has already written a generic 401/400/403 (no tenant/role disclosure, so it
 * stays non-enumerable) and the caller must return immediately. Any membership
 * role qualifies: these are read endpoints every participant (incl. guests)
 * legitimately uses.
 *
 * EVERY tenant-scoped read in this file (handleListMaps, handleStateV2,
 * handleChunksFetch, handleListZonesForTenant) runs through this gate, so the
 * X-Tenant cross-tenant exposure is closed uniformly — a spoofed header names a
 * tenant the caller does not belong to and the read is refused before any row
 * of that tenant is touched.
 */
async function resolveMemberTenant(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<NonNullable<ReturnType<typeof getTenantFromReq>> | null> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return null;
  }
  try {
    const membership = await requireMembership(req, auth.userId, prisma);
    if (!membership) {
      res.status(403).json({ error: 'forbidden' });
      return null;
    }
  } catch (e: unknown) {
    logger.error('[Map] membership check failed', e);
    res.status(500).json({ error: 'internal_error' });
    return null;
  }
  return tenant;
}

export async function handleListMaps(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const tenant = await resolveMemberTenant(prisma, req, res);
  if (!tenant) return;
  // The Express wrapper (maps.ts) does not attach a .catch to this handler, so an
  // unguarded prisma rejection would surface as an unhandled promise rejection.
  // Keep the read fenced like the state-v2/chunks handlers already are.
  try {
    const maps = await prisma.map.findMany({ where: { tenantId: tenant.id }, include: { zones: true, rooms: true } });
    res.json(maps);
  } catch (e: unknown) {
    logger.error('[Map] list maps failed', e);
    res.status(500).json({ error: 'internal_error' });
  }
}

async function autoPatchMapDimensions<
  T extends {
    id: string;
    width: number | null;
    height: number | null;
    tileWidth: number | null;
    tileHeight: number | null;
  },
>(prisma: PrismaClient, map: T, tenantSlug: string): Promise<T> {
  const defaults = { width: 32, height: 32, tileWidth: 16, tileHeight: 16 };
  if (map.width && map.height && map.tileWidth && map.tileHeight) return map;
  try {
    const updated = await prisma.map.update({
      where: { id: map.id },
      data: {
        width: map.width ?? defaults.width,
        height: map.height ?? defaults.height,
        tileWidth: map.tileWidth ?? defaults.tileWidth,
        tileHeight: map.tileHeight ?? defaults.tileHeight,
      },
    });
    logger.info('[Map] Auto-patched map dimensions on state-v2 fetch', { mapId: map.id, tenant: tenantSlug });
    return updated as unknown as T;
  } catch {
    return map;
  }
}

async function buildLayerIndex(prisma: PrismaClient, mapId: string) {
  const layers = await prisma.mapLayer.findMany({
    where: { mapId },
    select: { id: true, name: true, chunkSize: true },
  });
  const layerIndex: Record<string, { keys: string[]; chunkSize: number }> = {};
  for (const layer of layers) {
    const chunks = await prisma.mapChunk.findMany({ where: { layerId: layer.id }, select: { x: true, y: true } });
    const keys = chunks.map((c: { x: number; y: number }) => `${c.x}:${c.y}`);
    layerIndex[layer.name] = { keys, chunkSize: layer.chunkSize };
  }
  return layerIndex;
}

export async function handleStateV2(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  try {
    const tenant = await resolveMemberTenant(prisma, req, res);
    if (!tenant) return;
    let map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
    if (!map) {
      res.status(404).json({ error: 'map not found' });
      return;
    }

    map = await autoPatchMapDimensions(prisma, map, tenant.slug);

    const tilesets = await prisma.mapTileset.findMany({
      where: { mapId: map.id },
      orderBy: { slot: 'asc' },
      select: {
        id: true,
        slot: true,
        key: true,
        imageUrl: true,
        tileWidth: true,
        tileHeight: true,
        margin: true,
        spacing: true,
        hash: true,
      },
    });

    const layerIndex = await buildLayerIndex(prisma, map.id);

    const mapMeta = {
      width: map.width ?? null,
      height: map.height ?? null,
      tileWidth: map.tileWidth ?? null,
      tileHeight: map.tileHeight ?? null,
      chunkSize: map.chunkSize ?? 32,
      version: map.version ?? null,
    };

    res.json({ mapMeta, tilesetRegistry: tilesets, layerIndex });
  } catch (e: unknown) {
    logger.error('[Map] state-v2 failed', e);
    res.status(500).json({ error: 'internal_error' });
  }
}

const chunksSchema = z.object({ layer: z.string().min(1), keys: z.string().min(1) });

export async function handleChunksFetch(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  try {
    const tenant = await resolveMemberTenant(prisma, req, res);
    if (!tenant) return;

    const parse = chunksSchema.safeParse(req.query || {});
    if (!parse.success) {
      res.status(400).json({ error: 'layer and keys required' });
      return;
    }
    const { layer: layerName, keys } = parse.data;
    const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
    if (!map) {
      res.status(404).json({ error: 'map not found' });
      return;
    }
    const layer = await prisma.mapLayer.findUnique({ where: { mapId_name: { mapId: map.id, name: layerName } } });
    if (!layer) {
      res.json({ chunks: {} });
      return;
    }

    const keyList = keys
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const wanted: Array<{ x: number; y: number; key: string }> = [];
    for (const k of keyList) {
      const [xs, ys] = k.split(':');
      const x = Number(xs);
      const y = Number(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      wanted.push({ x, y, key: k });
    }
    if (wanted.length === 0) {
      res.json({ chunks: {} });
      return;
    }

    const orList = wanted.map((w) => ({ x: w.x, y: w.y }));
    const found = await prisma.mapChunk.findMany({
      where: { layerId: layer.id, OR: orList },
      select: { x: true, y: true, version: true, encoding: true, data: true },
    });
    const out: Record<string, { version: number; encoding: string; data: string }> = {};
    for (const c of found) {
      const key = `${c.x}:${c.y}`;
      const dataBuffer = c.data instanceof Buffer ? c.data : Buffer.from(c.data as Uint8Array);
      out[key] = { version: c.version, encoding: c.encoding, data: dataBuffer.toString('base64') };
    }

    res.setHeader('Cache-Control', 'no-cache');
    res.json({ chunks: out });
  } catch (e: unknown) {
    logger.error('[Map] chunks fetch failed', e);
    res.status(500).json({ error: 'internal_error' });
  }
}

export async function handleListZonesForTenant(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const tenant = await resolveMemberTenant(prisma, req, res);
  if (!tenant) return;
  // Fenced for the same reason as handleListMaps: the Express wrapper does not
  // catch a rejected read, which would otherwise become an unhandled rejection.
  try {
    const zones = await prisma.zone.findMany({ where: { tenantId: tenant.id } });
    res.json(zones);
  } catch (e: unknown) {
    logger.error('[Map] list zones failed', e);
    res.status(500).json({ error: 'internal_error' });
  }
}
