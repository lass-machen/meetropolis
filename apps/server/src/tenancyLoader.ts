import { z } from 'zod';
import type { PrismaClient } from './generated/prisma/index.js';

export type PackKind = 'asset' | 'avatar';

export interface AdditionalPackAccessRequest {
  tenantId?: string;
  packKind: PackKind;
  at: Date;
}

export interface AdditionalPackAccessResult {
  /** Every global pack deliberately placed in the enterprise catalogue. */
  catalogPackUuids: readonly string[];
  /** The catalogue subset published or granted to this audience. */
  accessiblePackUuids?: readonly string[];
}

// Local minimal type so the build works without the workspace/shared module.
// Optional commercial modules implementing this interface live outside the
// OSS tree. Schema migrations for those modules are applied out-of-band by
// a dedicated migrate service (see meetropolis-deploy/compose.yaml), not by
// the server boot path.
export type TenancyModule = {
  readonly version: 1;
  isMultiTenantEnabled(): boolean;
  bypassOssLimit?: () => boolean;
  /**
   * Optional enterprise pack-visibility boundary. It returns two GLOBAL-pack
   * UUID sets for one pack kind: every deliberately catalogued pack, and the
   * subset accessible to the requested audience. The enterprise implementation
   * owns all knowledge of
   * AssetPackCatalog / AvatarPackCatalog publication and pricing state and of
   * TenantAssetPack / TenantAvatarPack grants. A grant is active only while
   * revokedAt is null and expiresAt is null or later than `at`.
   *
   * `tenantId` is absent for public reads before login. In that case the
   * accessible set contains only explicitly published catalogue packs; an
   * empty set is a normal authoritative answer, not an error. With a tenant it
   * may additionally contain packs covered by an active grant. The accessible
   * set is a subset of the catalogue set. The host ignores and logs entries
   * outside that set, so the module cannot expand access accidentally.
   *
   * Absence preserves OSS behaviour exactly: every global pack remains
   * reachable. MANDATORY invariant: a global pack with NO catalogue row is
   * base equipment, not merchandise. The OSS host now enforces that invariant
   * structurally by excluding only catalogued-but-inaccessible UUIDs; the
   * optional module cannot remove base equipment. This direction is essential:
   * as of 2026-09-18 production holds 16 tenants, two global asset packs and one
   * global avatar pack, and exactly zero catalogue rows and zero grants.
   * Treating all global packs as merchandise would remove the furniture
   * palette and default characters from every tenant at once.
   */
  resolveAdditionalPackUuids?: (
    prisma: PrismaClient,
    request: AdditionalPackAccessRequest,
  ) => Promise<AdditionalPackAccessResult>;
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
const fnSchema = z.custom<() => boolean>((val) => typeof val === 'function', {
  message: 'expected function',
});

const packResolverSchema = z.custom<NonNullable<TenancyModule['resolveAdditionalPackUuids']>>(
  (val) => typeof val === 'function',
  { message: 'expected function' },
);

export const tenancyModuleSchema = z.object({
  version: z.literal(1),
  isMultiTenantEnabled: fnSchema,
  bypassOssLimit: fnSchema.optional(),
  resolveAdditionalPackUuids: packResolverSchema.optional(),
});

let cached: TenancyModule | null = null;

function unwrapDefaultExport(moduleValue: unknown): unknown {
  if (!moduleValue || typeof moduleValue !== 'object') return moduleValue;
  if (!('default' in moduleValue)) return moduleValue;
  const withDefault = moduleValue as { default?: unknown };
  return withDefault.default ?? moduleValue;
}

type TenancyImporter = () => Promise<unknown>;

function isAbsentTenancyPackage(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? error.code : undefined;
  const message = 'message' in error ? error.message : undefined;
  if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') return false;
  return typeof message === 'string' && /Cannot find (?:package|module) ['"]@meetropolis\/tenancy['"]/.test(message);
}

const importTenancyPackage: TenancyImporter = () => import('@meetropolis/tenancy');

/** Load and validate the optional module, distinguishing absence from breakage. */
export async function loadTenancyModule(importModule: TenancyImporter = importTenancyPackage): Promise<TenancyModule> {
  try {
    const modUnknown = await importModule();
    const parsed = tenancyModuleSchema.parse(unwrapDefaultExport(modUnknown));
    return parsed;
  } catch (error) {
    if (isAbsentTenancyPackage(error)) {
      return { version: 1, isMultiTenantEnabled: () => false };
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      'Failed to load @meetropolis/tenancy. Remove the broken package for OSS mode or install a module matching the tenancy loader contract. ' +
        `Cause: ${detail}`,
    );
  }
}

/**
 * Loads an optional proprietary tenancy module if present. Only the package's
 * exact absence selects OSS mode; import and contract failures abort startup.
 */
export async function getTenancyModule(): Promise<TenancyModule> {
  if (cached) return cached;
  cached = await loadTenancyModule();
  return cached;
}

/** Convenience helper when sync usage is preferred with a safe default. */
export function isMultiTenantEnabledSync(): boolean {
  // default without awaiting: return strict single-tenant. Callers that need
  // the real value should await getTenancyModule().
  return false;
}
