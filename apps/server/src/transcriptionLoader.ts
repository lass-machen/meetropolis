import type { Express } from 'express';
import type { PrismaClient } from './generated/prisma/index.js';
import type { requireApiToken, requireAuth, requireMembership } from './api/utils/authHelpers.js';
import type { resolveTenantBySlug } from './tenancy.js';
import { logger } from './logger.js';
import { z } from 'zod';

export const EXPECTED_TRANSCRIPTION_MODULE_VERSION = 1 as const;

export type TranscriptionJoinRequirement = { code: 'transcription_consent_required' } | null;

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
  setupRoutes(app: Express, deps: TranscriptionRouteDeps): void;
}

export const transcriptionModuleSchema = z.object({
  version: z.literal(EXPECTED_TRANSCRIPTION_MODULE_VERSION),
  publishIslandAttributes: z.boolean(),
  getJoinRequirement: z.function(),
  onGateChange: z.function(),
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

export async function getTranscriptionModule(): Promise<TranscriptionModule | null> {
  if (loadAttempted) return cached;
  loadAttempted = true;

  try {
    const moduleName: string = '@meetropolis/transcription';
    const modUnknown: unknown = await import(moduleName);
    const mod = transcriptionModuleSchema.parse(unwrapDefaultExport(modUnknown));

    cached = {
      version: EXPECTED_TRANSCRIPTION_MODULE_VERSION,
      publishIslandAttributes: mod.publishIslandAttributes,
      getJoinRequirement: mod.getJoinRequirement as TranscriptionModule['getJoinRequirement'],
      onGateChange: mod.onGateChange as TranscriptionModule['onGateChange'],
      setupRoutes: mod.setupRoutes as TranscriptionModule['setupRoutes'],
    };

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
