import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq, requireApiToken } from '../utils/authHelpers.js';
import { pathParam } from '../utils/requestHelpers.js';
import { broadcastMapUpdate } from '../utils/broadcast.js';
import { findMapById } from './maps.read.js';

export interface EditorAuthInfo {
  userId: string;
  tokenId?: string;
}

export interface MapMeta {
  tilesets?: unknown[];
  backgroundColor?: string;
  spawn?: { x: number; y: number };
  [key: string]: unknown;
}

export type AuthenticateResult = { ok: true; auth: EditorAuthInfo } | { ok: false };

export async function authenticateEditor(prisma: PrismaClient, req: express.Request): Promise<AuthenticateResult> {
  const sessionAuth = requireAuth(req);
  const tokenAuth = await requireApiToken(req, prisma);
  const auth = sessionAuth || tokenAuth;
  if (!auth) return { ok: false };
  return { ok: true, auth };
}

const tilesetSchema = z.object({
  key: z.string().min(1),
  imageUrl: z.string().min(1),
  tileWidth: z.number().int().positive(),
  tileHeight: z.number().int().positive(),
  margin: z.number().int().nonnegative().optional(),
  spacing: z.number().int().nonnegative().optional(),
  hash: z.string().optional(),
});

export async function handleAddTileset(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  try {
    const parse = tilesetSchema.safeParse(req.body || {});
    if (!parse.success) {
      res.status(400).json({ error: 'invalid payload' });
      return;
    }

    const tenant = getTenantFromReq(req);
    if (!tenant) {
      res.status(400).json({ error: 'tenant_required' });
      return;
    }
    const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
    if (!map) {
      res.status(404).json({ error: 'map not found' });
      return;
    }

    const existing = await prisma.mapTileset.findFirst({ where: { mapId: map.id, key: parse.data.key } });
    if (existing) {
      try {
        logger.debug('[Tilesets] already registered, skipping', { mapId: map.id, key: parse.data.key });
      } catch {}
      const tilesets = await prisma.mapTileset.findMany({ where: { mapId: map.id }, orderBy: { slot: 'asc' } });
      res.json(tilesets);
      return;
    }

    const last = await prisma.mapTileset.findFirst({ where: { mapId: map.id }, orderBy: { slot: 'desc' } });
    const newSlot = last ? last.slot + 1 : 0;
    await prisma.mapTileset.create({ data: { mapId: map.id, slot: newSlot, ...parse.data } });
    try {
      logger.info('[Tilesets] registry add', {
        mapId: map.id,
        slot: newSlot,
        key: parse.data.key,
        url: parse.data.imageUrl,
      });
    } catch {}

    const tilesets = await prisma.mapTileset.findMany({ where: { mapId: map.id }, orderBy: { slot: 'asc' } });
    broadcastMapUpdate(tenant.slug, 'tileset_registry_updated', {
      mapId: map.id,
      mapName: map.name,
      tilesetRegistry: tilesets,
    });
    res.json({ tilesetRegistry: tilesets });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') {
      try {
        logger.warn('[Tilesets] duplicate slot (race condition), returning current registry');
      } catch {}
      try {
        const tenant = getTenantFromReq(req);
        if (tenant) {
          const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
          if (map) {
            const tilesets = await prisma.mapTileset.findMany({ where: { mapId: map.id }, orderBy: { slot: 'asc' } });
            res.json({ tilesetRegistry: tilesets });
            return;
          }
        }
      } catch {}
    }
    logger.error('[Tilesets] add failed', e);
    res.status(500).json({ error: 'internal_error' });
  }
}

export {
  handleEditorStateGet,
  handleEditorStatePut,
  handleDeleteZones,
  handleListMapZones,
  type ZoneInput,
  type PreparedZone,
} from './maps.editor.zones.js';

export { handleResize, handleRename } from './maps.editor.resize.js';
