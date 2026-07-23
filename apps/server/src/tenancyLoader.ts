import { z } from 'zod';

// Local minimal type so the build works without the workspace/shared module.
// Optional commercial modules implementing this interface live outside the
// OSS tree. Schema migrations for those modules are applied out-of-band by
// a dedicated migrate service (see meetropolis-deploy/compose.yaml), not by
// the server boot path.
export type TenancyModule = {
  readonly version: 1;
  isMultiTenantEnabled(): boolean;
  bypassOssLimit?: () => boolean;
};

/**
 * Concurrent-user limit for OSS self-hosted installations.
 *
 * The value is a compile-time constant - 25 concurrent users across the
 * entire server, regardless of how many tenants exist. There is intentionally
 * no env-var override; raising the cap requires installing the proprietary
 * tenancy module, which gates the bypass behind `bypassOssLimit()`.
 *
 * Yes, a determined operator can fork and patch this number out. The point
 * is not to make it impossible - it is to make the OSS edition's commercial
 * boundary visible and self-documenting, and to ensure that anyone running
 * past it has made a deliberate, traceable choice rather than flipping an
 * env var.
 */
export const OSS_USER_LIMIT = 25;

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
