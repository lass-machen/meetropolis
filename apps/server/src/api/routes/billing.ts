import type express from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import Stripe from 'stripe';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq } from '../utils/authHelpers.js';

export function registerBillingRoutes(app: express.Application, prisma: PrismaClient) {
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
