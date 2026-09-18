import type express from 'express';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import { broadcastMapUpdate } from '../utils/broadcast.js';
import { resolveMapAutotileSnapshotForPaint } from '../utils/mapAutotilePalette.js';
import { pathParam } from '../utils/requestHelpers.js';
import { resolveEditorMemberTenant } from './maps.editor.js';
import { executePaint } from './maps.paint.service.js';
import { paintSchema, validatePaintSemantics } from './maps.paint.schema.js';
import { findMapById } from './maps.read.js';

export async function handlePaintRect(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  try {
    const tenant = await resolveEditorMemberTenant(prisma, req, res, { requireAdmin: true });
    if (!tenant) return;

    const parsed = paintSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      logger.warn('[Paint] invalid payload', parsed.error);
      res.status(400).json({ error: 'invalid payload' });
      return;
    }
    const semanticError = validatePaintSemantics(parsed.data);
    if (semanticError) {
      res.status(400).json({ error: semanticError });
      return;
    }

    const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
    if (!map) {
      res.status(404).json({ error: 'map not found' });
      return;
    }
    const snapshot = parsed.data.autotile
      ? await resolveMapAutotileSnapshotForPaint(prisma, req, parsed.data.autotile)
      : null;
    if (parsed.data.autotile && !snapshot) {
      res.status(400).json({ error: 'autotile_not_found' });
      return;
    }

    const result = await executePaint({ prisma, map, paint: parsed.data, autotileSnapshot: snapshot });
    if (result.updates.length > 0 || result.paletteEntryCreated) {
      broadcastMapUpdate(tenant.slug, 'chunks_updated', {
        mapId: map.id,
        mapName: map.name,
        layer: parsed.data.layer,
        updates: result.updates,
        autotilePaletteEntries: result.paletteEntryCreated && result.paletteEntry ? [result.paletteEntry] : undefined,
      });
    }
    if (result.collisionUpdates) {
      broadcastMapUpdate(tenant.slug, 'chunks_updated', {
        mapId: map.id,
        mapName: map.name,
        layer: 'collision',
        updates: result.collisionUpdates,
      });
    }
    res.json({
      updates: result.updates,
      collisionUpdates: result.collisionUpdates,
      autotilePaletteEntry: result.paletteEntry,
    });
  } catch (error: unknown) {
    logger.error('[Map] paint-rect failed', error);
    res.status(500).json({ error: 'internal_error' });
  }
}
