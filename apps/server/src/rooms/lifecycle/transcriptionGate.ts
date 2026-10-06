import type { Client } from 'colyseus';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import { getTranscriptionModuleSync } from '../../transcriptionLoader.js';

/** Close/error code for a missing transcription consent. 4006 stays reserved
 * for `guest_expired`, so the client can tell the two overlays apart. */
export const TRANSCRIPTION_CONSENT_REQUIRED_CODE = 4008;

export async function evaluateTranscriptionGate(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
): Promise<'allow' | 'consent_required'> {
  try {
    const transcriptionModule = getTranscriptionModuleSync();
    if (!transcriptionModule) return 'allow';

    const requirement = await transcriptionModule.getJoinRequirement(prisma, { tenantId, userId });
    return requirement ? 'consent_required' : 'allow';
  } catch (error) {
    logger.warn({
      event: 'transcription.gate_check_failed',
      tenantId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'consent_required';
  }
}

export async function enforceTranscriptionGate(
  client: Client,
  prisma: PrismaClient,
  tenantId: string | undefined,
  userId: string,
): Promise<boolean> {
  if (tenantId) {
    if ((await evaluateTranscriptionGate(prisma, tenantId, userId)) === 'allow') return false;
  } else if (!getTranscriptionModuleSync()) {
    return false;
  }

  client.error(TRANSCRIPTION_CONSENT_REQUIRED_CODE, 'transcription_consent_required');
  client.leave(1000);
  return true;
}
