import type express from 'express';
import { Prisma, PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireSuperAdmin } from '../utils/authHelpers.js';

// Prisma JSON fields reject raw `null`; they require Prisma.JsonNull instead.
const JSON_NULLABLE_KEYS: ReadonlySet<string> = new Set([
  'description', 'priceLabel', 'unitLabel', 'badgeLabel',
]);

function sanitiseJsonNulls<T extends Record<string, unknown>>(data: T): T {
  const out = { ...data };
  for (const key of JSON_NULLABLE_KEYS) {
    if (key in out && out[key] === null) {
      (out as Record<string, unknown>)[key] = Prisma.JsonNull;
    }
  }
  return out;
}

const i18nTextSchema = z.object({ en: z.string(), de: z.string() });

const pricingPlanCreateSchema = z.object({
  name: i18nTextSchema,
  description: i18nTextSchema.optional().nullable(),
  stripeProductId: z.string().optional().nullable(),
  stripePriceId: z.string().optional().nullable(),
  priceAmount: z.number().int().nonnegative().optional().nullable(),
  priceCurrency: z.string().default('EUR'),
  priceInterval: z.enum(['month', 'year']).optional().nullable(),
  priceLabel: i18nTextSchema.optional().nullable(),
  unitLabel: i18nTextSchema.optional().nullable(),
  features: z.array(i18nTextSchema).default([]),
  ctaLabel: i18nTextSchema,
  ctaUrl: z.string().optional().nullable(),
  highlighted: z.boolean().default(false),
  badgeLabel: i18nTextSchema.optional().nullable(),
  customPricing: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  visible: z.boolean().default(true),
});

export async function handlePublicPricingPlans(prisma: PrismaClient, _req: express.Request, res: express.Response): Promise<void> {
  try {
    const plans = await prisma.pricingPlan.findMany({
      where: { visible: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({
      plans: plans.map(({ stripeProductId, stripePriceId, visible, createdAt, updatedAt, ...rest }) => rest),
    });
  } catch (e: unknown) {
    logger.error({ event: 'public.pricing_plans.error', error: e instanceof Error ? e.message : String(e) });
    res.json({ plans: [] });
  }
}

export async function handleListPricingPlans(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) { res.status(403).json({ error: 'forbidden' }); return; }
  const plans = await prisma.pricingPlan.findMany({ orderBy: { sortOrder: 'asc' } });
  res.json({ plans });
}

export async function handleCreatePricingPlan(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) { res.status(403).json({ error: 'forbidden' }); return; }
  const parse = pricingPlanCreateSchema.safeParse(req.body || {});
  if (!parse.success) { res.status(400).json({ error: 'invalid payload', details: parse.error.flatten() }); return; }
  try {
    const plan = await prisma.pricingPlan.create({ data: sanitiseJsonNulls(parse.data) as any });
    res.json(plan);
  } catch (e: unknown) {
    logger.error({ event: 'admin.pricing_plan.create_error', error: e instanceof Error ? e.message : String(e) });
    res.status(400).json({ error: 'create_failed' });
  }
}

export async function handleUpdatePricingPlan(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) { res.status(403).json({ error: 'forbidden' }); return; }
  const { id } = req.params;
  const parse = pricingPlanCreateSchema.partial().safeParse(req.body || {});
  if (!parse.success) { res.status(400).json({ error: 'invalid payload', details: parse.error.flatten() }); return; }
  try {
    const plan = await prisma.pricingPlan.update({ where: { id }, data: sanitiseJsonNulls(parse.data) as any });
    res.json(plan);
  } catch (e: unknown) {
    logger.error({ event: 'admin.pricing_plan.update_error', error: e instanceof Error ? e.message : String(e) });
    res.status(400).json({ error: 'update_failed' });
  }
}

export async function handleDeletePricingPlan(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) { res.status(403).json({ error: 'forbidden' }); return; }
  const { id } = req.params;
  try {
    await prisma.pricingPlan.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e: unknown) {
    logger.error({ event: 'admin.pricing_plan.delete_error', error: e instanceof Error ? e.message : String(e) });
    res.status(400).json({ error: 'delete_failed' });
  }
}
