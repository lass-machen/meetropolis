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
  setupRoutes(app: Express, deps: TranscriptionRouteDeps): void;
}

export const transcriptionModuleSchema = z.object({
  version: z.literal(EXPECTED_TRANSCRIPTION_MODULE_VERSION),
  publishIslandAttributes: z.boolean(),
  getJoinRequirement: z.function(),
  onGateChange: z.function(),
  evaluateJoin: z.function().optional(),
  isTenantTranscriptionActive: z.function().optional(),
  setupRoutes: z.function(),
});

let cached: TranscriptionModule | null = null;
let loadAttempted = false;

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
    setupRoutes: mod.setupRoutes as TranscriptionModule['setupRoutes'],
  };
}

export async function getTranscriptionModule(): Promise<TranscriptionModule | null> {
  if (loadAttempted) return cached;
  loadAttempted = true;

  try {
    const moduleName: string = '@meetropolis/transcription';
    const modUnknown: unknown = await import(moduleName);
    cached = toTranscriptionModule(transcriptionModuleSchema.parse(unwrapDefaultExport(modUnknown)));

    logger.info({ event: 'transcription.module_loaded', version: EXPECTED_TRANSCRIPTION_MODULE_VERSION });
    return cached;
  } catch (_error) {
    logger.debug({ event: 'transcription.module_not_available', message: 'Transcription disabled (OSS)' });
    cached = null;
    return null;
  }
}

export function getTranscriptionModuleSync(): TranscriptionModule | null {
  return cached;
}
