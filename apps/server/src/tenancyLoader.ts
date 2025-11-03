import { z } from 'zod';
import type { TenancyModule } from '@meetropolis/shared';

const tenancyModuleSchema = z.object({
  version: z.literal(1),
  isMultiTenantEnabled: z.function().args().returns(z.boolean()),
});

let cached: TenancyModule | null = null;

/**
 * Loads an optional proprietary tenancy module if present. Falls back to a strict
 * single-tenant adapter in OSS builds. No network or phone-home logic.
 */
export async function getTenancyModule(): Promise<TenancyModule> {
  if (cached) return cached;

  try {
    // Dynamic import on runtime; absent in OSS. Use unknown and validate.
    const modUnknown: unknown = await import('@meetropolis/tenancy');
    const mod = tenancyModuleSchema.parse((modUnknown as any)?.default ?? modUnknown);
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

