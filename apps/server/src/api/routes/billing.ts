import type express from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import Stripe from 'stripe';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq } from '../utils/authHelpers.js';

export function registerBillingRoutes(app: express.Application, prisma: PrismaClient) {
  // Get billing status (current plan, usage, limits)
  app.get('/billing/status', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });

    try {
      const tenantRec = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      if (!tenantRec) return res.status(404).json({ error: 'tenant_not_found' });

      // Count current active users across all rooms for this tenant
      let currentUsage = 0;
      try {
        const presences = await prisma.presence.count({
          where: { tenantId: tenant.id, updatedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } }
        });
        currentUsage = presences;
      } catch { }

      // Get subscription details from Stripe if available
      let subscription: any = null;
      let plan: any = null;
      if (process.env.STRIPE_SECRET_KEY && tenantRec.stripeSubscriptionId) {
        try {
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
          const sub = await stripe.subscriptions.retrieve(tenantRec.stripeSubscriptionId, {
            expand: ['items.data.price.product', 'default_payment_method']
          });
          const price = sub.items?.data?.[0]?.price as any;
          const product = price?.product as any;
          subscription = {
            id: sub.id,
            status: sub.status,
            currentPeriodStart: new Date((sub.current_period_start || 0) * 1000).toISOString(),
            currentPeriodEnd: new Date((sub.current_period_end || 0) * 1000).toISOString(),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            cancelAt: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
          };
          plan = {
            id: price?.id,
            name: product?.name || 'Unknown Plan',
            description: product?.description || null,
            amount: price?.unit_amount ? price.unit_amount / 100 : 0,
            currency: price?.currency?.toUpperCase() || 'EUR',
            interval: price?.recurring?.interval || 'month',
            concurrentLimit: Number(price?.metadata?.concurrent_limit || product?.metadata?.concurrent_limit || 0),
          };
        } catch (e: any) {
          logger.warn({ event: 'billing.status.stripe_error', error: e?.message });
        }
      }

      // Determine billing status
      const billingEnabled = !!process.env.STRIPE_SECRET_KEY;
      const hasSubscription = !!subscription && subscription.status === 'active';
      const isFreeplan = !hasSubscription && tenantRec.freeSeats > 0;

      return res.json({
        billing: {
          enabled: billingEnabled,
          status: tenantRec.status || (hasSubscription ? 'active' : 'free'),
          hasSubscription,
          subscription,
          plan: plan || (isFreeplan ? { name: 'Free', concurrentLimit: tenantRec.freeSeats, amount: 0, currency: 'EUR', interval: 'month' } : null),
        },
        usage: {
          currentUsers: currentUsage,
          limit: tenantRec.concurrentLimit || tenantRec.freeSeats || 0,
          freeSeats: tenantRec.freeSeats,
          paidSeats: tenantRec.concurrentLimit,
        },
        tenant: {
          id: tenantRec.id,
          slug: tenantRec.slug,
          name: tenantRec.name,
          bypassLimits: tenantRec.bypassLimits,
          isInternal: tenantRec.isInternal,
        },
      });
    } catch (e: any) {
      logger.error({ event: 'billing.status.error', error: e?.message || String(e) });
      return res.status(500).json({ error: 'status_failed' });
    }
  });

  // Get invoices
  app.get('/billing/invoices', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });

    try {
      const tenantRec = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      if (!tenantRec?.stripeCustomerId) return res.json({ invoices: [] });

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const invoices = await stripe.invoices.list({
        customer: tenantRec.stripeCustomerId,
        limit: 24,
      });

      const formatted = invoices.data.map(inv => ({
        id: inv.id,
        number: inv.number,
        status: inv.status,
        amount: (inv.amount_due || 0) / 100,
        currency: inv.currency?.toUpperCase() || 'EUR',
        date: inv.created ? new Date(inv.created * 1000).toISOString() : null,
        dueDate: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
        paidAt: inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000).toISOString() : null,
        hostedUrl: inv.hosted_invoice_url,
        pdfUrl: inv.invoice_pdf,
      }));

      return res.json({ invoices: formatted });
    } catch (e: any) {
      logger.error({ event: 'billing.invoices.error', error: e?.message || String(e) });
      return res.status(500).json({ error: 'invoices_failed' });
    }
  });

  // Get available plans/prices
  app.get('/billing/plans', async (_req: express.Request, res: express.Response) => {
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });

    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const prices = await stripe.prices.list({
        active: true,
        expand: ['data.product'],
        limit: 20,
      });

      const plans = prices.data
        .filter(p => (p.product as any)?.active)
        .map(p => {
          const product = p.product as any;
          return {
            priceId: p.id,
            productId: product?.id,
            name: product?.name || 'Unknown',
            description: product?.description || null,
            amount: (p.unit_amount || 0) / 100,
            currency: p.currency?.toUpperCase() || 'EUR',
            interval: p.recurring?.interval || 'month',
            concurrentLimit: Number(p.metadata?.concurrent_limit || product?.metadata?.concurrent_limit || 0),
            features: (product?.metadata?.features || '').split(',').filter(Boolean),
          };
        })
        .sort((a, b) => a.amount - b.amount);

      return res.json({ plans });
    } catch (e: any) {
      logger.error({ event: 'billing.plans.error', error: e?.message || String(e) });
      return res.status(500).json({ error: 'plans_failed' });
    }
  });

  // Cancel subscription
  app.post('/billing/cancel', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });

    try {
      const tenantRec = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      if (!tenantRec?.stripeSubscriptionId) return res.status(400).json({ error: 'no_subscription' });

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);

      // Cancel at period end (graceful cancellation)
      const updated = await stripe.subscriptions.update(tenantRec.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      return res.json({
        success: true,
        cancelAt: updated.cancel_at ? new Date(updated.cancel_at * 1000).toISOString() : null,
        currentPeriodEnd: new Date((updated.current_period_end || 0) * 1000).toISOString(),
      });
    } catch (e: any) {
      logger.error({ event: 'billing.cancel.error', error: e?.message || String(e) });
      return res.status(500).json({ error: 'cancel_failed' });
    }
  });

  // Reactivate cancelled subscription
  app.post('/billing/reactivate', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });

    try {
      const tenantRec = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      if (!tenantRec?.stripeSubscriptionId) return res.status(400).json({ error: 'no_subscription' });

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);

      // Remove cancellation
      const updated = await stripe.subscriptions.update(tenantRec.stripeSubscriptionId, {
        cancel_at_period_end: false,
      });

      return res.json({ success: true, status: updated.status });
    } catch (e: any) {
      logger.error({ event: 'billing.reactivate.error', error: e?.message || String(e) });
      return res.status(500).json({ error: 'reactivate_failed' });
    }
  });

  // Checkout session
  app.post('/billing/checkout-session', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    if (tenant.isInternal || tenant.bypassLimits) return res.status(400).json({ error: 'billing_not_applicable' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const schema = z.object({ priceId: z.string().min(3).optional(), plan: z.string().min(1).optional(), returnUrl: z.string().url().optional() }).refine(v => !!(v.priceId || v.plan), { message: 'priceId or plan required' });
      const parse = schema.safeParse(req.body || {});
      if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
      const priceId = parse.data.priceId || process.env[`STRIPE_PRICE_${(parse.data.plan || '').toUpperCase()}` as any];
      if (!priceId) return res.status(400).json({ error: 'price_not_configured' });

      let tenantRec = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      let customerId = (tenantRec as any)?.stripeCustomerId || null;
      if (!customerId) {
        const customer = await stripe.customers.create({
          name: tenantRec?.name || tenant.slug,
          metadata: { tenantId: tenant.id, tenantSlug: tenant.slug },
        });
        customerId = customer.id;
        await prisma.tenant.update({ where: { id: tenant.id }, data: { stripeCustomerId: customerId } });
      }

      const origin = (req.headers.origin as string) || (req.headers.referer as string) || process.env.BILLING_PUBLIC_URL || '';
      const successUrl = (parse.data.returnUrl || origin || '').replace(/\/$/, '') + '/billing/success';
      const cancelUrl = (parse.data.returnUrl || origin || '').replace(/\/$/, '') + '/billing/cancel';

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: tenant.id,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        subscription_data: {
          metadata: { tenantId: tenant.id, tenantSlug: tenant.slug },
        },
        allow_promotion_codes: true,
      });
      return res.json({ url: session.url });
    } catch (e: any) {
      logger.error({ event: 'billing.checkout.error', error: e?.message || String(e) });
      return res.status(500).json({ error: 'checkout_failed' });
    }
  });

  // Portal session
  app.post('/billing/portal-session', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    if (tenant.isInternal || tenant.bypassLimits) return res.status(400).json({ error: 'billing_not_applicable' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const tenantRec = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      const customerId = (tenantRec as any)?.stripeCustomerId;
      if (!customerId) return res.status(400).json({ error: 'no_customer' });
      const origin = (req.headers.origin as string) || (req.headers.referer as string) || process.env.BILLING_PUBLIC_URL || '';
      const returnUrl = (origin || '').replace(/\/$/, '') + '/billing/account';
      const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
      return res.json({ url: session.url });
    } catch (e: any) {
      logger.error({ event: 'billing.portal.error', error: e?.message || String(e) });
      return res.status(500).json({ error: 'portal_failed' });
    }
  });

  // Webhook
  app.post('/billing/webhook', async (req: express.Request, res: express.Response) => {
    if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const sig = req.headers['stripe-signature'] as string;
      const raw = (req as any).body as Buffer;
      const event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET!);

      async function applyLimitFromSubscription(sub: Stripe.Subscription) {
        let tenantId = (sub.metadata as any)?.tenantId as string | undefined;
        let customerId = (sub.customer as any) as string | undefined;
        let limit = 0;
        try {
          const items = (sub.items?.data || []) as any[];
          const first = items[0];
          const price: any = first?.price;
          const m = (price?.metadata || {}) as Record<string, string>;
          const pM = (price?.product?.metadata || {}) as Record<string, string>;
          const metaLimit = Number(m.concurrent_limit || pM.concurrent_limit || 0);
          limit = Number.isFinite(metaLimit) && metaLimit > 0 ? metaLimit : 0;
        } catch { }
        if (!tenantId && customerId) {
          const t = await prisma.tenant.findFirst({ where: { stripeCustomerId: customerId } });
          if (t) tenantId = t.id;
        }
        if (!tenantId) return;
        const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!t) return;
        await prisma.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: customerId ?? t.stripeCustomerId ?? undefined, stripeSubscriptionId: (sub.id || undefined) as any, status: (sub.status || t.status || null) as any, concurrentLimit: limit > 0 ? limit : t.concurrentLimit } });
      }

      switch (event.type) {
        case 'checkout.session.completed': {
          const s = event.data.object as Stripe.Checkout.Session;
          const subId = (s.subscription as any) as string | undefined;
          const customerId = (s.customer as any) as string | undefined;
          const tenantId = (s.client_reference_id as string) || (s.metadata as any)?.tenantId;
          if (tenantId) {
            await prisma.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: customerId ?? undefined, stripeSubscriptionId: subId ?? undefined } });
          }
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId, { expand: ['items.data.price.product'] });
            await applyLimitFromSubscription(sub);
          }
          break;
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          const sub = event.data.object as Stripe.Subscription;
          if (!(sub.items?.data?.[0]?.price as any)?.product?.metadata) {
            const full = await stripe.subscriptions.retrieve(sub.id, { expand: ['items.data.price.product'] });
            await applyLimitFromSubscription(full);
          } else {
            await applyLimitFromSubscription(sub);
          }
          break;
        }
        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription;
          const tenantId = (sub.metadata as any)?.tenantId as string | undefined;
          if (tenantId) {
            try { await prisma.tenant.update({ where: { id: tenantId }, data: { concurrentLimit: 0 } }); } catch { }
          } else {
            const customerId = (sub.customer as any) as string | undefined;
            if (customerId) { try { await prisma.tenant.updateMany({ where: { stripeCustomerId: customerId }, data: { concurrentLimit: 0 } }); } catch { } }
          }
          break;
        }
        default:
          break;
      }
      res.json({ received: true });
    } catch (e: any) {
      logger.error({ event: 'billing.webhook.error', error: e?.message || String(e) });
      return res.status(400).send('webhook error');
    }
  });
}
