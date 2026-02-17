import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import Stripe from 'stripe';
import { logger } from '../../logger.js';
import {
  requireSuperAdmin,
  normalizeEmailForStorage,
} from '../utils/authHelpers.js';

const RoleEnum = z.enum(['owner', 'admin', 'member']);

export function registerAdminUserRoutes(app: express.Application, prisma: PrismaClient) {
  // List users for a tenant
  app.get('/admin/tenants/:id/users', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    try {
      const memberships = await prisma.membership.findMany({
        where: { tenantId: req.params.id },
        include: {
          user: {
            select: {
              id: true, email: true, name: true, imageUrl: true,
              createdAt: true, emailVerifiedAt: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      res.json(memberships.map(m => ({
        userId: m.user.id,
        email: m.user.email,
        name: m.user.name,
        imageUrl: m.user.imageUrl,
        role: m.role,
        createdAt: m.user.createdAt,
        emailVerifiedAt: m.user.emailVerifiedAt,
        memberSince: m.createdAt,
      })));
    } catch (e: unknown) {
      logger.error({ event: 'admin.tenant_users.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'fetch_failed' });
    }
  });

  // Update user role within a tenant
  app.patch('/admin/tenants/:id/users/:userId/role', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    const schema = z.object({ role: RoleEnum });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const membership = await prisma.membership.findFirst({
        where: { tenantId: req.params.id, userId: req.params.userId },
      });
      if (!membership) return res.status(404).json({ error: 'membership_not_found' });
      await prisma.membership.update({
        where: { id: membership.id },
        data: { role: parse.data.role as any },
      });
      res.json({ ok: true });
    } catch (e: unknown) {
      logger.error({ event: 'admin.tenant_users.role_update.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'update_failed' });
    }
  });

  // Remove user from tenant (delete membership, not the user)
  app.delete('/admin/tenants/:id/users/:userId', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    try {
      const membership = await prisma.membership.findFirst({
        where: { tenantId: req.params.id, userId: req.params.userId },
      });
      if (!membership) return res.status(404).json({ error: 'membership_not_found' });

      // Safety: prevent removing the last owner
      if (membership.role === 'owner') {
        const ownerCount = await prisma.membership.count({
          where: { tenantId: req.params.id, role: 'owner' },
        });
        if (ownerCount <= 1) {
          return res.status(400).json({ error: 'cannot_remove_last_owner' });
        }
      }

      await prisma.membership.delete({ where: { id: membership.id } });
      res.json({ ok: true });
    } catch (e: unknown) {
      logger.error({ event: 'admin.tenant_users.remove.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'remove_failed' });
    }
  });

  // Add user to tenant by email
  app.post('/admin/tenants/:id/users', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    const schema = z.object({
      email: z.string().email(),
      role: z.enum(['admin', 'member']),
    });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const email = normalizeEmailForStorage(parse.data.email);
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return res.status(404).json({ error: 'user_not_found' });

      const existing = await prisma.membership.findFirst({
        where: { tenantId: req.params.id, userId: user.id },
      });
      if (existing) return res.status(400).json({ error: 'already_member' });

      const membership = await prisma.membership.create({
        data: {
          tenantId: req.params.id,
          userId: user.id,
          role: parse.data.role as any,
        },
      });
      res.json({
        id: membership.id,
        userId: user.id,
        email: user.email,
        name: user.name,
        role: membership.role,
        memberSince: membership.createdAt,
      });
    } catch (e: unknown) {
      logger.error({ event: 'admin.tenant_users.add.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'add_failed' });
    }
  });

  // Detailed billing info for a tenant
  app.get('/admin/tenants/:id/billing', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
      if (!tenant) return res.status(404).json({ error: 'not_found' });

      const billing: Record<string, unknown> = {
        tenantId: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        stripeCustomerId: tenant.stripeCustomerId,
        stripeSubscriptionId: tenant.stripeSubscriptionId,
        trialStartedAt: tenant.trialStartedAt,
        trialEndsAt: tenant.trialEndsAt,
        trialConvertedAt: tenant.trialConvertedAt,
        paymentFailedAt: tenant.paymentFailedAt,
        gracePeriodEndsAt: tenant.gracePeriodEndsAt,
        dunningStep: tenant.dunningStep ?? 0,
        lastDunningEmailAt: tenant.lastDunningEmailAt,
        pausedAt: tenant.pausedAt,
        pauseEndsAt: tenant.pauseEndsAt,
        pauseReason: tenant.pauseReason,
      };

      // Fetch Stripe details if available
      if (tenant.stripeCustomerId && process.env.STRIPE_SECRET_KEY) {
        try {
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
          const customer = await stripe.customers.retrieve(tenant.stripeCustomerId);
          billing.stripeCustomer = customer.deleted ? null : {
            email: (customer as Stripe.Customer).email,
            name: (customer as Stripe.Customer).name,
            balance: (customer as Stripe.Customer).balance,
            currency: (customer as Stripe.Customer).currency,
            delinquent: (customer as Stripe.Customer).delinquent,
            created: (customer as Stripe.Customer).created,
          };

          if (tenant.stripeSubscriptionId) {
            const sub = await stripe.subscriptions.retrieve(tenant.stripeSubscriptionId, {
              expand: ['items.data.price.product'],
            });
            billing.stripeSubscription = {
              id: sub.id,
              status: sub.status,
              currentPeriodStart: sub.current_period_start,
              currentPeriodEnd: sub.current_period_end,
              cancelAtPeriodEnd: sub.cancel_at_period_end,
              canceledAt: sub.canceled_at,
              items: sub.items.data.map(item => ({
                priceId: item.price.id,
                productId: typeof item.price.product === 'string' ? item.price.product : (item.price.product as Stripe.Product).id,
                productName: typeof item.price.product === 'string' ? null : (item.price.product as Stripe.Product).name,
                unitAmount: item.price.unit_amount,
                currency: item.price.currency,
                interval: item.price.recurring?.interval,
              })),
            };
          }

          const invoices = await stripe.invoices.list({
            customer: tenant.stripeCustomerId,
            limit: 10,
          });
          billing.recentInvoices = invoices.data.map(inv => ({
            id: inv.id,
            status: inv.status,
            amountDue: inv.amount_due,
            amountPaid: inv.amount_paid,
            currency: inv.currency,
            created: inv.created,
            hostedInvoiceUrl: inv.hosted_invoice_url,
          }));
        } catch (stripeErr: unknown) {
          logger.error({ event: 'admin.tenant_billing.stripe.error', error: stripeErr instanceof Error ? stripeErr.message : String(stripeErr) });
          billing.stripeError = 'failed_to_fetch_stripe_data';
        }
      }

      // Fetch pack assignments
      const [assetPacks, avatarPacks] = await Promise.all([
        prisma.tenantAssetPack.findMany({
          where: { tenantId: req.params.id, revokedAt: null },
          include: { assetPack: { select: { uuid: true, name: true, author: true, version: true } } },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.tenantAvatarPack.findMany({
          where: { tenantId: req.params.id, revokedAt: null },
          include: { avatarPack: { select: { uuid: true, name: true, author: true, version: true } } },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      billing.packs = {
        assetPacks: assetPacks.map(a => ({
          id: a.id,
          packUuid: a.assetPack.uuid,
          packName: a.assetPack.name,
          author: a.assetPack.author,
          version: a.assetPack.version,
          grantSource: a.grantSource,
          createdAt: a.createdAt,
        })),
        avatarPacks: avatarPacks.map(a => ({
          id: a.id,
          packUuid: a.avatarPack.uuid,
          packName: a.avatarPack.name,
          author: a.avatarPack.author,
          version: a.avatarPack.version,
          grantSource: a.grantSource,
          createdAt: a.createdAt,
        })),
      };

      res.json(billing);
    } catch (e: unknown) {
      logger.error({ event: 'admin.tenant_billing.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'billing_fetch_failed' });
    }
  });

  // Tenant packs list
  app.get('/admin/tenants/:id/packs', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    try {
      const [assetPacks, avatarPacks] = await Promise.all([
        prisma.tenantAssetPack.findMany({
          where: { tenantId: req.params.id, revokedAt: null },
          include: { assetPack: { select: { uuid: true, name: true, author: true, version: true } } },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.tenantAvatarPack.findMany({
          where: { tenantId: req.params.id, revokedAt: null },
          include: { avatarPack: { select: { uuid: true, name: true, author: true, version: true } } },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      res.json({
        assetPacks: assetPacks.map(a => ({
          id: a.id,
          packUuid: a.assetPack.uuid,
          packName: a.assetPack.name,
          author: a.assetPack.author,
          version: a.assetPack.version,
          grantSource: a.grantSource,
          purchasedMajorVersion: a.purchasedMajorVersion,
          expiresAt: a.expiresAt,
          grantedBy: a.grantedBy,
          createdAt: a.createdAt,
        })),
        avatarPacks: avatarPacks.map(a => ({
          id: a.id,
          packUuid: a.avatarPack.uuid,
          packName: a.avatarPack.name,
          author: a.avatarPack.author,
          version: a.avatarPack.version,
          grantSource: a.grantSource,
          purchasedMajorVersion: a.purchasedMajorVersion,
          expiresAt: a.expiresAt,
          grantedBy: a.grantedBy,
          createdAt: a.createdAt,
        })),
      });
    } catch (e: unknown) {
      logger.error({ event: 'admin.tenant_packs.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'packs_fetch_failed' });
    }
  });

  // Billing audit log
  app.get('/admin/billing/audit-log', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    const schema = z.object({
      tenantId: z.string().optional(),
      eventType: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    });
    const parse = schema.safeParse(req.query || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid query params' });
    try {
      const where: Record<string, unknown> = {};
      if (parse.data.tenantId) where.tenantId = parse.data.tenantId;
      if (parse.data.eventType) where.eventType = parse.data.eventType;

      const [logs, total] = await Promise.all([
        prisma.billingAuditLog.findMany({
          where,
          include: { tenant: { select: { slug: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          take: parse.data.limit,
          skip: parse.data.offset,
        }),
        prisma.billingAuditLog.count({ where }),
      ]);

      res.json({
        logs: logs.map(l => ({
          id: l.id,
          tenantId: l.tenantId,
          tenantSlug: l.tenant.slug,
          tenantName: l.tenant.name,
          eventType: l.eventType,
          eventSource: l.eventSource,
          stripeEventId: l.stripeEventId,
          previousValues: l.previousValues,
          newValues: l.newValues,
          triggeredBy: l.triggeredBy,
          metadata: l.metadata,
          createdAt: l.createdAt,
        })),
        total,
        limit: parse.data.limit,
        offset: parse.data.offset,
      });
    } catch (e: unknown) {
      logger.error({ event: 'admin.billing.audit_log.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'audit_log_failed' });
    }
  });
}
