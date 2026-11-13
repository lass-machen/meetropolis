import type { Express } from 'express';
import type { PrismaClient } from './generated/prisma/index.js';
import type { requireApiToken, requireAuth, requireMembership } from './api/utils/authHelpers.js';
import type { resolveTenantBySlug } from './tenancy.js';
import { logger } from './logger.js';
import { z } from 'zod';

export const EXPECTED_TRANSCRIPTION_MODULE_VERSION = 1 as const;

export type TranscriptionJoinRequirement = { code: 'transcription_consent_required' } | null;

export interface TranscriptionJoinEvaluation {
  requirement: TranscriptionJoinRequirement;
  /** True only when this evaluation checked the user's consent and found it valid. */
  consentVerified: boolean;
}

export interface TranscriptionGateChange {
  tenantId: string;
  userId?: string;
}

export interface TranscriptionRouteDeps {
  prisma: PrismaClient;
  logger: { info(o: object): void; warn(o: object): void; error(o: object): void };
  requireAuth: typeof requireAuth;
  requireApiToken: typeof requireApiToken;
  resolveTenantBySlug: typeof resolveTenantBySlug;
  requireMembership: typeof requireMembership;
  getEmailModule: () => Promise<unknown>;
}

export interface TranscriptionModule {
  readonly version: typeof EXPECTED_TRANSCRIPTION_MODULE_VERSION;
  publishIslandAttributes: boolean;
  getJoinRequirement(
    prisma: PrismaClient,
    ctx: { tenantId: string; userId: string },
  ): Promise<TranscriptionJoinRequirement>;
  onGateChange(listener: (e: TranscriptionGateChange) => void): () => void;
  /**
   * Optional: the join requirement plus whether this evaluation checked the
   * user's consent for the tenant and found it valid. The transcriber joins a
   * publisher's SFU allow-list on that verdict only; without this method no
   * client is ever cleared for it (fail-closed).
   */
  evaluateJoin?(prisma: PrismaClient, ctx: { tenantId: string; userId: string }): Promise<TranscriptionJoinEvaluation>;
  /**
   * Optional, synchronous and free of database access: true while the
   * tenant's transcription is running. Read on the SFU allow-list push path,
   * so a module serves it from state it already keeps. A module without it
   * leaves the transcriber out of every allow-list (fail-closed).
   */
  isTenantTranscriptionActive?(tenantId: string): boolean;
  /**
   * Optional: revokes every active OAuth refresh token after a database restore
   * and returns how many were revoked. Absent in transcription builds without it.
   */
  revokeOAuthRefreshTokensAfterRestore?(prisma: PrismaClient, now: Date): Promise<number>;
  setupRoutes(app: Express, deps: TranscriptionRouteDeps): void;
}

export const transcriptionModuleSchema = z.object({
  version: z.literal(EXPECTED_TRANSCRIPTION_MODULE_VERSION),
  publishIslandAttributes: z.boolean(),
  getJoinRequirement: z.function(),
  onGateChange: z.function(),
  evaluateJoin: z.function().optional(),
  isTenantTranscriptionActive: z.function().optional(),
  // Optional: absent in transcription builds without OAuth restore revocation.
  revokeOAuthRefreshTokensAfterRestore: z.function().optional(),
  setupRoutes: z.function(),
});

/** Outcome of the last load attempt: the package is absent, installed but rejected, or loaded. */
export type TranscriptionLoadState = 'absent' | 'rejected' | 'loaded';

type TranscriptionImporter = () => Promise<unknown>;

let cached: TranscriptionModule | null = null;
let loadAttempted = false;
let loadState: TranscriptionLoadState | undefined;

function unwrapDefaultExport(moduleValue: unknown): unknown {
  if (!moduleValue || typeof moduleValue !== 'object') return moduleValue;
  if (!('default' in moduleValue)) return moduleValue;
  const withDefault = moduleValue as { default?: unknown };
  return withDefault.default ?? moduleValue;
}

/** Binds a parsed module to the contract, optional methods included. */
export function toTranscriptionModule(mod: z.infer<typeof transcriptionModuleSchema>): TranscriptionModule {
  return {
    version: EXPECTED_TRANSCRIPTION_MODULE_VERSION,
    publishIslandAttributes: mod.publishIslandAttributes,
    getJoinRequirement: mod.getJoinRequirement as TranscriptionModule['getJoinRequirement'],
    onGateChange: mod.onGateChange as TranscriptionModule['onGateChange'],
    evaluateJoin: mod.evaluateJoin as TranscriptionModule['evaluateJoin'],
    isTenantTranscriptionActive: mod.isTenantTranscriptionActive as TranscriptionModule['isTenantTranscriptionActive'],
    revokeOAuthRefreshTokensAfterRestore:
      mod.revokeOAuthRefreshTokensAfterRestore as TranscriptionModule['revokeOAuthRefreshTokensAfterRestore'],
    setupRoutes: mod.setupRoutes as TranscriptionModule['setupRoutes'],
  };
}

/** Only the exact absence of the package selects OSS mode; any other failure is an installed but rejected module. */
function isAbsentTranscriptionPackage(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? error.code : undefined;
  const message = 'message' in error ? error.message : undefined;
  if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') return false;
  return (
    typeof message === 'string' && /Cannot find (?:package|module) ['"]@meetropolis\/transcription['"]/.test(message)
  );
}

// Literal specifier so the source policy can see the optional import; types/shims.d.ts declares the module.
const importTranscriptionPackage: TranscriptionImporter = () => import('@meetropolis/transcription');

/**
 * Loads and validates the optional module. The state separates an absent package,
 * which selects OSS mode, from an installed package that fails to load or to validate.
 */
export async function resolveTranscriptionModule(
  importModule: TranscriptionImporter = importTranscriptionPackage,
): Promise<{ state: TranscriptionLoadState; module: TranscriptionModule | null }> {
  try {
    const modUnknown: unknown = await importModule();
    const parsed = transcriptionModuleSchema.parse(unwrapDefaultExport(modUnknown));
    return { state: 'loaded', module: toTranscriptionModule(parsed) };
  } catch (error) {
    return { state: isAbsentTranscriptionPackage(error) ? 'absent' : 'rejected', module: null };
  }
}

/** Outcome of the last load attempt; undefined before the first one. */
export function getTranscriptionLoadState(): TranscriptionLoadState | undefined {
  return loadState;
}

export async function getTranscriptionModule(): Promise<TranscriptionModule | null> {
  if (loadAttempted) return cached;
  loadAttempted = true;

  const resolution = await resolveTranscriptionModule();
  loadState = resolution.state;
  cached = resolution.module;
  if (cached === null) {
    logger.debug({ event: 'transcription.module_not_available', message: 'Transcription disabled (OSS)' });
    return null;
  }
  logger.info({ event: 'transcription.module_loaded', version: EXPECTED_TRANSCRIPTION_MODULE_VERSION });
  return cached;
}

export function getTranscriptionModuleSync(): TranscriptionModule | null {
  return cached;
}
