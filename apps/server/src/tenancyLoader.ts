import { z } from 'zod';
import type { PrismaClient } from './generated/prisma/index.js';
import { logger } from './logger.js';

// Local minimal type so the build works without the workspace/shared module.
export type TenancyModule = {
  readonly version: 1;
  isMultiTenantEnabled(): boolean;
  bypassOssLimit?: () => boolean;
  runEnterpriseMigrations?: (config: EnterpriseMigrationConfig) => Promise<void>;
};

export interface EnterpriseMigrationConfig {
  executeRawSql: (sql: string) => Promise<void>;
  logger: {
    info(obj: object): void;
    error(obj: object): void;
    warn(obj: object): void;
  };
}

/**
 * Concurrent-user limit for OSS self-hosted installations.
 *
 * Default: 25. Can be overridden at runtime via the `OSS_USER_LIMIT` env var
 * (positive integer). The enterprise tenancy module bypasses this entirely
 * via `bypassOssLimit()`.
 */
function readOssUserLimitFromEnv(): number {
  const raw = process.env.OSS_USER_LIMIT;
  if (!raw) return 25;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 25;
  return n;
}

export const OSS_USER_LIMIT = readOssUserLimitFromEnv();

// zod 4 reworked the `z.function()` API completely (now a function factory
// with `.implement()`). For pure shape validation of imported modules a
// `typeof === "function"` check via `z.custom` is sufficient.
const fnSchema = z.custom<(...args: unknown[]) => unknown>((val) => typeof val === 'function', {
  message: 'expected function',
});

const tenancyModuleSchema = z.object({
  version: z.literal(1),
  isMultiTenantEnabled: fnSchema,
  bypassOssLimit: fnSchema.optional(),
  runEnterpriseMigrations: fnSchema.optional(),
});

let cached: TenancyModule | null = null;

function unwrapDefaultExport(moduleValue: unknown): unknown {
  if (!moduleValue || typeof moduleValue !== 'object') return moduleValue;
  if (!('default' in moduleValue)) return moduleValue;
  const withDefault = moduleValue as { default?: unknown };
  return withDefault.default ?? moduleValue;
}

/**
 * Loads an optional proprietary tenancy module if present. Falls back to a strict
 * single-tenant adapter in OSS builds. No network or phone-home logic.
 */
export async function getTenancyModule(): Promise<TenancyModule> {
  if (cached) return cached;

  try {
    // Dynamic import on runtime; absent in OSS. Use unknown and validate.
    const modUnknown: unknown = await import('@meetropolis/tenancy');
    const parsed = tenancyModuleSchema.parse(unwrapDefaultExport(modUnknown));
    // zod's z.function() loses precise generic argument types; cast to the
    // declared TenancyModule shape once schema validation has confirmed
    // the structure.
    const mod = parsed as unknown as TenancyModule;
    cached = mod;
    return mod;
  } catch {
    const fallback: TenancyModule = {
      version: 1,
      isMultiTenantEnabled: () => false,
    };
    cached = fallback;
    return fallback;
  }
}

/** Convenience helper when sync usage is preferred with a safe default. */
export function isMultiTenantEnabledSync(): boolean {
  // default without awaiting: return strict single-tenant. Callers that need
  // the real value should await getTenancyModule().
  return false;
}

/**
 * Legacy hook: apply the enterprise raw-SQL migrations if the submodule
 * exposes them. As of the schema-composition pipeline (compose-schema.cjs +
 * schema.composed.prisma), `prisma db push`/`migrate deploy` already creates
 * the enterprise tables and columns from the merged schema. The raw-SQL files
 * remain in the submodule as an idempotent safety net for legacy databases
 * that were created before the composed schema existed; `IF NOT EXISTS`
 * guards make them no-ops against an already migrated database.
 */
export async function applyEnterpriseMigrationsIfPresent(prisma: PrismaClient): Promise<void> {
  const tenancy = await getTenancyModule();
  if (!tenancy.runEnterpriseMigrations) return;
  await tenancy.runEnterpriseMigrations({
    executeRawSql: async (sql: string) => {
      await prisma.$executeRawUnsafe(sql);
    },
    logger,
  });
}
