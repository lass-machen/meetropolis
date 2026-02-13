import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth, requireInternalOwner } from '../utils/authHelpers.js';
import { grantPackAccess, parseMajorVersion } from '../utils/packAccess.js';

const catalogUpsertSchema = z.object({
  pricingModel: z.enum(['free', 'one_time', 'subscription']).optional(),
  published: z.boolean().optional(),
  featured: z.boolean().optional(),
  stripeProductId: z.string().nullable().optional(),
  stripePriceId: z.string().nullable().optional(),
  priceAmountCents: z.number().int().nonnegative().optional(),
  priceCurrency: z.string().max(10).optional(),
  priceInterval: z.string().nullable().optional(),
  previewImageUrl: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

const grantSchema = z.object({
  tenantId: z.string().min(1),
  packType: z.enum(['asset', 'avatar']),
  packUuid: z.string().min(1),
});

const revokeSchema = z.object({
  tenantId: z.string().min(1),
  packType: z.enum(['asset', 'avatar']),
  packUuid: z.string().min(1),
});

export function registerPackCatalogAdminRoutes(app: express.Application, prisma: PrismaClient) {
  // GET /admin/pack-catalog/asset-packs — all asset packs with catalog data
  app.get('/admin/pack-catalog/asset-packs', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });

    try {
      const packs = await prisma.assetPack.findMany({
        orderBy: { createdAt: 'desc' },
        include: { catalog: true },
      });
      const out = packs.map(p => ({
        id: p.id,
        uuid: p.uuid,
        name: p.name,
        author: p.author,
        version: p.version,
        description: p.description,
        createdAt: p.createdAt,
        catalog: p.catalog ?? null,
      }));
      res.json(out);
    } catch (e: unknown) {
      logger.error({ event: 'pack_catalog.asset_list.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // PUT /admin/pack-catalog/asset-packs/:uuid — upsert catalog entry
  app.put('/admin/pack-catalog/asset-packs/:uuid', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });

    const parse = catalogUpsertSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'invalid payload', details: parse.error.errors });

    try {
      const pack = await prisma.assetPack.findUnique({ where: { uuid: req.params.uuid } });
      if (!pack) return res.status(404).json({ error: 'asset_pack_not_found' });

      const data = parse.data;
      const catalog = await prisma.assetPackCatalog.upsert({
        where: { assetPackId: pack.id },
        update: {
          ...(data.pricingModel !== undefined && { pricingModel: data.pricingModel }),
          ...(data.published !== undefined && { published: data.published }),
          ...(data.featured !== undefined && { featured: data.featured }),
          ...(data.stripeProductId !== undefined && { stripeProductId: data.stripeProductId }),
          ...(data.stripePriceId !== undefined && { stripePriceId: data.stripePriceId }),
          ...(data.priceAmountCents !== undefined && { priceAmountCents: data.priceAmountCents }),
          ...(data.priceCurrency !== undefined && { priceCurrency: data.priceCurrency }),
          ...(data.priceInterval !== undefined && { priceInterval: data.priceInterval }),
          ...(data.previewImageUrl !== undefined && { previewImageUrl: data.previewImageUrl }),
          ...(data.tags !== undefined && { tags: data.tags }),
        },
        create: {
          assetPackId: pack.id,
          pricingModel: data.pricingModel ?? 'free',
          published: data.published ?? false,
          featured: data.featured ?? false,
          stripeProductId: data.stripeProductId ?? null,
          stripePriceId: data.stripePriceId ?? null,
          priceAmountCents: data.priceAmountCents ?? 0,
          priceCurrency: data.priceCurrency ?? 'EUR',
          priceInterval: data.priceInterval ?? null,
          previewImageUrl: data.previewImageUrl ?? null,
          tags: data.tags ?? [],
        },
      });

      // Auto-grant to all tenants if changed to free + published
      if (catalog.pricingModel === 'free' && catalog.published) {
        const tenants = await prisma.tenant.findMany({ select: { id: true } });
        for (const t of tenants) {
          await prisma.tenantAssetPack.upsert({
            where: { tenantId_assetPackId: { tenantId: t.id, assetPackId: pack.id } },
            update: {},
            create: {
              tenantId: t.id,
              assetPackId: pack.id,
              grantSource: 'free',
              purchasedMajorVersion: parseMajorVersion(pack.version),
            },
          });
        }
        logger.info({ event: 'pack_catalog.free_auto_grant', packUuid: pack.uuid, tenantCount: tenants.length });
      }

      res.json(catalog);
    } catch (e: unknown) {
      logger.error({ event: 'pack_catalog.asset_upsert.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // GET /admin/pack-catalog/avatar-packs — all avatar packs with catalog data
  app.get('/admin/pack-catalog/avatar-packs', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });

    try {
      const packs = await prisma.avatarPack.findMany({
        orderBy: { createdAt: 'desc' },
        include: { catalog: true },
      });
      const out = packs.map(p => ({
        id: p.id,
        uuid: p.uuid,
        name: p.name,
        author: p.author,
        version: p.version,
        description: p.description,
        createdAt: p.createdAt,
        catalog: p.catalog ?? null,
      }));
      res.json(out);
    } catch (e: unknown) {
      logger.error({ event: 'pack_catalog.avatar_list.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // PUT /admin/pack-catalog/avatar-packs/:uuid — upsert catalog entry
  app.put('/admin/pack-catalog/avatar-packs/:uuid', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });

    const parse = catalogUpsertSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'invalid payload', details: parse.error.errors });

    try {
      const pack = await prisma.avatarPack.findUnique({ where: { uuid: req.params.uuid } });
      if (!pack) return res.status(404).json({ error: 'avatar_pack_not_found' });

      const data = parse.data;
      const catalog = await prisma.avatarPackCatalog.upsert({
        where: { avatarPackId: pack.id },
        update: {
          ...(data.pricingModel !== undefined && { pricingModel: data.pricingModel }),
          ...(data.published !== undefined && { published: data.published }),
          ...(data.featured !== undefined && { featured: data.featured }),
          ...(data.stripeProductId !== undefined && { stripeProductId: data.stripeProductId }),
          ...(data.stripePriceId !== undefined && { stripePriceId: data.stripePriceId }),
          ...(data.priceAmountCents !== undefined && { priceAmountCents: data.priceAmountCents }),
          ...(data.priceCurrency !== undefined && { priceCurrency: data.priceCurrency }),
          ...(data.priceInterval !== undefined && { priceInterval: data.priceInterval }),
          ...(data.previewImageUrl !== undefined && { previewImageUrl: data.previewImageUrl }),
          ...(data.tags !== undefined && { tags: data.tags }),
        },
        create: {
          avatarPackId: pack.id,
          pricingModel: data.pricingModel ?? 'free',
          published: data.published ?? false,
          featured: data.featured ?? false,
          stripeProductId: data.stripeProductId ?? null,
          stripePriceId: data.stripePriceId ?? null,
          priceAmountCents: data.priceAmountCents ?? 0,
          priceCurrency: data.priceCurrency ?? 'EUR',
          priceInterval: data.priceInterval ?? null,
          previewImageUrl: data.previewImageUrl ?? null,
          tags: data.tags ?? [],
        },
      });

      // Auto-grant to all tenants if changed to free + published
      if (catalog.pricingModel === 'free' && catalog.published) {
        const tenants = await prisma.tenant.findMany({ select: { id: true } });
        for (const t of tenants) {
          await prisma.tenantAvatarPack.upsert({
            where: { tenantId_avatarPackId: { tenantId: t.id, avatarPackId: pack.id } },
            update: {},
            create: {
              tenantId: t.id,
              avatarPackId: pack.id,
              grantSource: 'free',
              purchasedMajorVersion: parseMajorVersion(pack.version),
            },
          });
        }
        logger.info({ event: 'pack_catalog.free_auto_grant', packUuid: pack.uuid, tenantCount: tenants.length });
      }

      res.json(catalog);
    } catch (e: unknown) {
      logger.error({ event: 'pack_catalog.avatar_upsert.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // POST /admin/pack-catalog/grant — manual grant
  app.post('/admin/pack-catalog/grant', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });

    const parse = grantSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'invalid payload', details: parse.error.errors });

    try {
      const { tenantId, packType, packUuid } = parse.data;

      // Get pack version for purchasedMajorVersion
      let version = '0';
      if (packType === 'asset') {
        const pack = await prisma.assetPack.findUnique({ where: { uuid: packUuid } });
        if (!pack) return res.status(404).json({ error: 'asset_pack_not_found' });
        version = pack.version;
      } else {
        const pack = await prisma.avatarPack.findUnique({ where: { uuid: packUuid } });
        if (!pack) return res.status(404).json({ error: 'avatar_pack_not_found' });
        version = pack.version;
      }

      await grantPackAccess(prisma, {
        tenantId,
        packType,
        packUuid,
        grantSource: 'manual',
        purchasedMajorVersion: parseMajorVersion(version),
        grantedBy: auth.userId,
      });

      res.json({ ok: true });
    } catch (e: unknown) {
      logger.error({ event: 'pack_catalog.grant.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // POST /admin/pack-catalog/revoke — revoke pack access
  app.post('/admin/pack-catalog/revoke', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });

    const parse = revokeSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'invalid payload', details: parse.error.errors });

    try {
      const { tenantId, packType, packUuid } = parse.data;

      if (packType === 'asset') {
        const pack = await prisma.assetPack.findUnique({ where: { uuid: packUuid } });
        if (!pack) return res.status(404).json({ error: 'asset_pack_not_found' });
        await prisma.tenantAssetPack.updateMany({
          where: { tenantId, assetPackId: pack.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      } else {
        const pack = await prisma.avatarPack.findUnique({ where: { uuid: packUuid } });
        if (!pack) return res.status(404).json({ error: 'avatar_pack_not_found' });
        await prisma.tenantAvatarPack.updateMany({
          where: { tenantId, avatarPackId: pack.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      logger.info({ event: 'pack_catalog.revoked', tenantId, packType, packUuid, revokedBy: auth.userId });
      res.json({ ok: true });
    } catch (e: unknown) {
      logger.error({ event: 'pack_catalog.revoke.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });
}
