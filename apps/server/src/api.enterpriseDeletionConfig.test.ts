import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-enterprise-deletion-config';
process.env.API_TOKEN_PEPPER = process.env.API_TOKEN_PEPPER || 'test-pepper-enterprise-deletion-config';

const { captured, billingFixture } = vi.hoisted(() => {
  const captured: { config: object | undefined } = { config: undefined };
  const noop = (): void => undefined;
  const billingFixture = {
    version: 3 as const,
    setupBillingRoutes: noop,
    installEarlyMiddleware: noop,
    getTrialStatus: noop,
    startTrial: noop,
    getDunningStatus: noop,
    TRIAL_DAYS: 7,
    GRACE_PERIOD_DAYS: 7,
    CANCELLATION_DAYS: 14,
    setupAdminRoutes: noop,
    setupTenantAdminRoutes: (_app: unknown, config: object) => {
      captured.config = config;
    },
    setupPricingPlanRoutes: noop,
    setupTenantUserRoutes: noop,
    setupPackMarketplaceRoutes: noop,
    setupDesktopUpdateRoutes: noop,
  };
  return { captured, billingFixture };
});

vi.mock('@meetropolis/billing', () => ({
  ...billingFixture,
  default: billingFixture,
}));

vi.mock('./db.js', () => ({
  createPrismaClient: () => ({}),
}));

const { journalResolver } = vi.hoisted(() => ({
  journalResolver: vi.fn(),
}));

// The resolver factory is wiring, not the tested logic: it is
// counted and controllably rejected or resolved.
vi.mock('./services/tenantDeletionPlanning.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/tenantDeletionPlanning.js')>();
  return { ...actual, createJournalPlanResolver: journalResolver };
});

import { registerApi } from './api.js';

type ResolvePlan = (tx: unknown, input: { tenantId: string; transactionTime: Date }) => Promise<unknown>;

interface PlanInput {
  idempotencyKey: string;
  policyVersion: string;
  journalUntil: Date;
  tasks: unknown[];
}

function resolveTenantDeletionPlanOf(config: object): unknown {
  return Reflect.get(config, 'resolveTenantDeletionPlan');
}

async function captureTenantAdminConfig(): Promise<object> {
  captured.config = undefined;
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  await registerApi(app);
  if (captured.config === undefined) {
    throw new Error('enterprise admin fixture did not receive tenant admin config');
  }
  return captured.config;
}

const journalDirs: string[] = [];
const envSnapshot = {
  journalDir: process.env.DELETION_JOURNAL_DIR,
  retentionDays: process.env.BACKUP_RETENTION_DAYS,
};

function restoreDeletionEnv(): void {
  if (envSnapshot.journalDir === undefined) delete process.env.DELETION_JOURNAL_DIR;
  else process.env.DELETION_JOURNAL_DIR = envSnapshot.journalDir;
  if (envSnapshot.retentionDays === undefined) delete process.env.BACKUP_RETENTION_DAYS;
  else process.env.BACKUP_RETENTION_DAYS = envSnapshot.retentionDays;
}

afterEach(async () => {
  restoreDeletionEnv();
  captured.config = undefined;
  const dirs = journalDirs.splice(0);
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('enterprise admin deletion plan config', () => {
  it('W1 registerApi passes resolveTenantDeletionPlan as a function when the journal directory is configured', async () => {
    const journalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deletion-journal-'));
    journalDirs.push(journalDir);
    process.env.DELETION_JOURNAL_DIR = journalDir;
    process.env.BACKUP_RETENTION_DAYS = '14';

    const config = await captureTenantAdminConfig();
    expect(typeof resolveTenantDeletionPlanOf(config)).toBe('function');
  });

  it('W2 registerApi leaves resolveTenantDeletionPlan undefined without DELETION_JOURNAL_DIR', async () => {
    delete process.env.DELETION_JOURNAL_DIR;
    process.env.BACKUP_RETENTION_DAYS = '14';

    const config = await captureTenantAdminConfig();
    expect(resolveTenantDeletionPlanOf(config)).toBeUndefined();
  });

  it('W3 two concurrent first calls create the resolver once and both get its result', async () => {
    const journalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deletion-journal-'));
    journalDirs.push(journalDir);
    process.env.DELETION_JOURNAL_DIR = journalDir;
    process.env.BACKUP_RETENTION_DAYS = '14';

    const plan: PlanInput = {
      idempotencyKey: 'w3-key',
      policyVersion: 'w3-policy',
      journalUntil: new Date('2026-12-01T00:00:00.000Z'),
      tasks: [],
    };
    const resolver = vi.fn(async () => plan);
    journalResolver.mockReset();
    journalResolver.mockResolvedValue(resolver);

    const config = await captureTenantAdminConfig();
    const resolve = resolveTenantDeletionPlanOf(config);
    expect(typeof resolve).toBe('function');
    if (typeof resolve !== 'function') return;
    const call = resolve as unknown as ResolvePlan;
    const input = { tenantId: 'w3-tenant', transactionTime: new Date('2026-11-08T00:00:00.000Z') };

    const results = await Promise.all([call({}, input), call({}, input)]);

    expect(journalResolver).toHaveBeenCalledTimes(1);
    expect(journalResolver).toHaveBeenCalledWith(expect.objectContaining({ journalDir }));
    expect(results[0]).toEqual(plan);
    expect(results[1]).toEqual(plan);
  });

  it('W4 a failed resolver creation returns undefined and the next call creates a new resolver', async () => {
    const journalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deletion-journal-'));
    journalDirs.push(journalDir);
    process.env.DELETION_JOURNAL_DIR = journalDir;
    process.env.BACKUP_RETENTION_DAYS = '14';

    const plan: PlanInput = {
      idempotencyKey: 'w4-key',
      policyVersion: 'w4-policy',
      journalUntil: new Date('2026-12-01T00:00:00.000Z'),
      tasks: [],
    };
    const resolver = vi.fn(async () => plan);
    journalResolver.mockReset();
    journalResolver.mockRejectedValueOnce(new Error('journal unavailable')).mockResolvedValueOnce(resolver);

    const config = await captureTenantAdminConfig();
    const resolve = resolveTenantDeletionPlanOf(config);
    expect(typeof resolve).toBe('function');
    if (typeof resolve !== 'function') return;
    const call = resolve as unknown as ResolvePlan;
    const input = { tenantId: 'w4-tenant', transactionTime: new Date('2026-11-08T00:00:00.000Z') };

    const first = await call({}, input);
    expect(first).toBeUndefined();
    expect(journalResolver).toHaveBeenCalledTimes(1);

    const second = await call({}, input);
    expect(journalResolver).toHaveBeenCalledTimes(2);
    expect(second).toEqual(plan);
  });
});
