import { z } from 'zod';
import type { PrismaClient } from './generated/prisma/index.js';
import { logger } from './logger.js';

// Lokaler Minimaltyp, um Build ohne Workspace/Shared zu ermöglichen
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

/** Default concurrent user limit for OSS self-hosted installations */
export const OSS_USER_LIMIT = 25;

const tenancyModuleSchema = z.object({
  version: z.literal(1),
  isMultiTenantEnabled: z.function().args().returns(z.boolean()),
  bypassOssLimit: z.function().args().returns(z.boolean()).optional(),
  runEnterpriseMigrations: z.function().optional(),
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
    // zod's z.function() loses precise generic argument types — cast to the
    // declared TenancyModule shape after schema validation has confirmed the
    // structure.
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
 * Apply enterprise SQL migrations if the enterprise submodule is present.
 * No-op in OSS-only installs.
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
