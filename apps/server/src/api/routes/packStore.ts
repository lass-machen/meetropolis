import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import Stripe from 'stripe';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq, requireMembership } from '../utils/authHelpers.js';
import { grantPackAccess, parseMajorVersion } from '../utils/packAccess.js';

const installSchema = z.object({
  packType: z.enum(['asset', 'avatar']),
  packUuid: z.string().min(1),
});

const checkoutSchema = z.object({
  packType: z.enum(['asset', 'avatar']),
  packUuid: z.string().min(1),
  returnUrl: z.string().url().optional(),
});

export function registerPackStoreRoutes(app: express.Application, prisma: PrismaClient) {
  // GET /pack-store/catalog — browse published packs with access status
  app.get('/pack-store/catalog', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });

    const membership = await requireMembership(req, auth.userId, prisma);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      // Get published asset packs
      const assetCatalogs = await prisma.assetPackCatalog.findMany({
        where: { published: true },
        include: { assetPack: true },
      });
      const assetAccess = await prisma.tenantAssetPack.findMany({
        where: { tenantId: tenant.id },
      });
      const assetAccessMap = new Map(assetAccess.map(a => [a.assetPackId, a]));

      const assetPacks = assetCatalogs.map(c => ({
        packType: 'asset' as const,
        id: c.assetPack.id,
        uuid: c.assetPack.uuid,
        name: c.assetPack.name,
        author: c.assetPack.author,
        version: c.assetPack.version,
        description: c.assetPack.description,
        catalog: {
          pricingModel: c.pricingModel,
          featured: c.featured,
          priceAmountCents: c.priceAmountCents,
          priceCurrency: c.priceCurrency,
          priceInterval: c.priceInterval,
          previewImageUrl: c.previewImageUrl,
          tags: c.tags,
        },
        access: assetAccessMap.get(c.assetPackId) ?? null,
      }));

      // Get published avatar packs
      const avatarCatalogs = await prisma.avatarPackCatalog.findMany({
        where: { published: true },
        include: { avatarPack: true },
      });
      const avatarAccess = await prisma.tenantAvatarPack.findMany({
        where: { tenantId: tenant.id },
      });
      const avatarAccessMap = new Map(avatarAccess.map(a => [a.avatarPackId, a]));

      const avatarPacks = avatarCatalogs.map(c => ({
        packType: 'avatar' as const,
        id: c.avatarPack.id,
        uuid: c.avatarPack.uuid,
        name: c.avatarPack.name,
        author: c.avatarPack.author,
        version: c.avatarPack.version,
        description: c.avatarPack.description,
        catalog: {
          pricingModel: c.pricingModel,
          featured: c.featured,
          priceAmountCents: c.priceAmountCents,
          priceCurrency: c.priceCurrency,
          priceInterval: c.priceInterval,
          previewImageUrl: c.previewImageUrl,
          tags: c.tags,
        },
        access: avatarAccessMap.get(c.avatarPackId) ?? null,
      }));

      res.json({ assetPacks, avatarPacks });
    } catch (e: unknown) {
      logger.error({ event: 'pack_store.catalog.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // POST /pack-store/install — install a free pack
  app.post('/pack-store/install', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });

    const membership = await requireMembership(req, auth.userId, prisma);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const parse = installSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'invalid payload', details: parse.error.errors });

    try {
      const { packType, packUuid } = parse.data;

      // Verify pack exists and is free
      let version: string;
      if (packType === 'asset') {
        const pack = await prisma.assetPack.findUnique({ where: { uuid: packUuid }, include: { catalog: true } });
        if (!pack) return res.status(404).json({ error: 'pack_not_found' });
        if (!pack.catalog || !pack.catalog.published) return res.status(404).json({ error: 'pack_not_published' });
        if (pack.catalog.pricingModel !== 'free') return res.status(400).json({ error: 'pack_not_free' });
        version = pack.version;
      } else {
        const pack = await prisma.avatarPack.findUnique({ where: { uuid: packUuid }, include: { catalog: true } });
        if (!pack) return res.status(404).json({ error: 'pack_not_found' });
        if (!pack.catalog || !pack.catalog.published) return res.status(404).json({ error: 'pack_not_published' });
        if (pack.catalog.pricingModel !== 'free') return res.status(400).json({ error: 'pack_not_free' });
        version = pack.version;
      }

      await grantPackAccess(prisma, {
        tenantId: tenant.id,
        packType,
        packUuid,
        grantSource: 'free',
        purchasedMajorVersion: parseMajorVersion(version),
      });

      res.json({ ok: true });
    } catch (e: unknown) {
      logger.error({ event: 'pack_store.install.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // POST /pack-store/checkout — create Stripe checkout for paid pack
  app.post('/pack-store/checkout', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });

    const membership = await requireMembership(req, auth.userId, prisma);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const parse = checkoutSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'invalid payload', details: parse.error.errors });

    try {
      const { packType, packUuid, returnUrl } = parse.data;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });

      // Validate pack and catalog
      let packName: string;
      let packVersion: string;
      let catalog: { pricingModel: string; stripePriceId: string | null } | null;

      if (packType === 'asset') {
        const pack = await prisma.assetPack.findUnique({ where: { uuid: packUuid }, include: { catalog: true } });
        if (!pack) return res.status(404).json({ error: 'pack_not_found' });
        if (!pack.catalog || !pack.catalog.published) return res.status(404).json({ error: 'pack_not_published' });
        catalog = pack.catalog;
        packName = pack.name;
        packVersion = pack.version;
      } else {
        const pack = await prisma.avatarPack.findUnique({ where: { uuid: packUuid }, include: { catalog: true } });
        if (!pack) return res.status(404).json({ error: 'pack_not_found' });
        if (!pack.catalog || !pack.catalog.published) return res.status(404).json({ error: 'pack_not_published' });
        catalog = pack.catalog;
        packName = pack.name;
        packVersion = pack.version;
      }

      if (catalog.pricingModel === 'free') return res.status(400).json({ error: 'pack_is_free' });
      if (!catalog.stripePriceId) return res.status(400).json({ error: 'stripe_price_not_configured' });

      // Ensure Stripe customer exists
      let tenantRec = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      let customerId = tenantRec?.stripeCustomerId ?? null;
      if (!customerId) {
        const customer = await stripe.customers.create({
          name: tenantRec?.name || tenant.slug,
          metadata: { tenantId: tenant.id, tenantSlug: tenant.slug },
        });
        customerId = customer.id;
        await prisma.tenant.update({ where: { id: tenant.id }, data: { stripeCustomerId: customerId } });
      }

      const origin = (req.headers.origin as string) || (req.headers.referer as string) || process.env.BILLING_PUBLIC_URL || '';
      const successUrl = (returnUrl || origin || '').replace(/\/$/, '') + '/pack-store/success';
      const cancelUrl = (returnUrl || origin || '').replace(/\/$/, '') + '/pack-store/cancel';

      const mode = catalog.pricingModel === 'subscription' ? 'subscription' : 'payment';
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: mode as 'payment' | 'subscription',
        customer: customerId,
        line_items: [{ price: catalog.stripePriceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          tenantId: tenant.id,
          packType,
          packUuid,
          packMajorVersion: String(parseMajorVersion(packVersion)),
          purpose: 'pack_purchase',
        },
      };

      if (mode === 'subscription') {
        sessionParams.subscription_data = {
          metadata: {
            tenantId: tenant.id,
            packType,
            packUuid,
            purpose: 'pack_subscription',
          },
        };
      }

      const session = await stripe.checkout.sessions.create(sessionParams);

      logger.info({ event: 'pack_store.checkout_created', tenantId: tenant.id, packType, packUuid, packName });
      res.json({ url: session.url });
    } catch (e: unknown) {
      logger.error({ event: 'pack_store.checkout.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'checkout_failed' });
    }
  });

  // GET /pack-store/my-packs — list installed packs for tenant
  app.get('/pack-store/my-packs', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });

    try {
      const now = new Date();

      const assetAccess = await prisma.tenantAssetPack.findMany({
        where: {
          tenantId: tenant.id,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        include: { assetPack: true },
      });
      const assetPacks = assetAccess
        .filter(a => a.purchasedMajorVersion >= parseMajorVersion(a.assetPack.version))
        .map(a => ({
          packType: 'asset' as const,
          uuid: a.assetPack.uuid,
          name: a.assetPack.name,
          author: a.assetPack.author,
          version: a.assetPack.version,
          grantSource: a.grantSource,
          expiresAt: a.expiresAt,
          grantedAt: a.createdAt,
        }));

      const avatarAccess = await prisma.tenantAvatarPack.findMany({
        where: {
          tenantId: tenant.id,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        include: { avatarPack: true },
      });
      const avatarPacks = avatarAccess
        .filter(a => a.purchasedMajorVersion >= parseMajorVersion(a.avatarPack.version))
        .map(a => ({
          packType: 'avatar' as const,
          uuid: a.avatarPack.uuid,
          name: a.avatarPack.name,
          author: a.avatarPack.author,
          version: a.avatarPack.version,
          grantSource: a.grantSource,
          expiresAt: a.expiresAt,
          grantedAt: a.createdAt,
        }));

      res.json({ assetPacks, avatarPacks });
    } catch (e: unknown) {
      logger.error({ event: 'pack_store.my_packs.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });
}
