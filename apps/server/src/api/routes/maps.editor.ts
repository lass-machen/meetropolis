import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq, requireApiToken, requireMembership } from '../utils/authHelpers.js';
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

/** Resolved tenant projection returned once an editor request is authorized. */
export type EditorMemberTenant = NonNullable<ReturnType<typeof getTenantFromReq>>;

/**
 * Auth + tenant + membership gate for tenant-scoped map *editor* endpoints.
 *
 * The mirror of resolveMemberTenant in maps.read.ts, but authenticates through
 * authenticateEditor (session OR API token) because editor endpoints also serve
 * programmatic API-token callers. Tenant resolution (tenancy.ts) lets the
 * client-supplied X-Tenant header override the session, and — as documented in
 * resolveTenantBySlug — "resolution is NOT authorization": without a membership
 * check an authenticated caller could aim req.tenant at ANY tenant and
 * read/write its maps. Returns the resolved tenant only when the caller holds a
 * qualifying membership in it; otherwise it has already written a generic
 * 401/400/403 (no tenant/role disclosure, so it stays non-enumerable) and the
 * caller MUST return immediately.
 *
 * `requireAdmin` gates the genuine editor mutations — paint, resize, rename,
 * editor-state, zones — to owner/admin (matching handleDeleteZones). Read
 * endpoints omit it and accept any membership role, consistent with the uniform
 * read policy in maps.read.ts. Tileset registration is deliberately in the
 * read-policy group (membership, not admin): it runs on every member's normal
 * world load (see handleAddTileset), so gating it to admin would break regular
 * members. Membership alone still closes the cross-tenant hole.
 */
export async function resolveEditorMemberTenant(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
  opts?: { requireAdmin?: boolean },
): Promise<EditorMemberTenant | null> {
  const authResult = await authenticateEditor(prisma, req);
  if (!authResult.ok) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return null;
  }
  try {
    const membership = await requireMembership(req, authResult.auth.userId, prisma);
    if (!membership) {
      res.status(403).json({ error: 'forbidden' });
      return null;
    }
    if (opts?.requireAdmin && membership.role !== 'admin' && membership.role !== 'owner') {
      res.status(403).json({ error: 'forbidden - admin required' });
      return null;
    }
  } catch (e: unknown) {
    logger.error('[Map] editor membership check failed', e);
    res.status(500).json({ error: 'internal_error' });
    return null;
  }
  return tenant;
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
    // Any member of the owning tenant may register a tileset, NOT just
    // owner/admin. Tileset registration is fired from the normal world-load
    // path: useEditorLoader seeds the default and asset-pack tilesets for every
    // authenticated member on join (via gameBridge.registerTileset ->
    // tilesetRegistrationQueue), independent of the admin-gated editor toggle.
    // Gating this to admin therefore 403s every regular member on world load.
    // The membership check still closes the cross-tenant hole — a member of
    // another tenant cannot register against this tenant's map — and the write
    // is idempotent (an already-registered key returns the existing list as a
    // no-op). The genuine editor mutations (paint, resize, rename,
    // editor-state, zones) stay owner/admin.
    const tenant = await resolveEditorMemberTenant(prisma, req, res);
    if (!tenant) return;

    const parse = tilesetSchema.safeParse(req.body || {});
    if (!parse.success) {
      res.status(400).json({ error: 'invalid payload' });
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
