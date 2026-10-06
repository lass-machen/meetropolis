import type { Client } from 'colyseus';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import { getTranscriptionModuleSync } from '../../transcriptionLoader.js';

/** Close/error code for a missing transcription consent. 4006 stays reserved
 * for `guest_expired`, so the client can tell the two overlays apart. */
export const TRANSCRIPTION_CONSENT_REQUIRED_CODE = 4008;

/** Error code for a join rejected because the gate could not be evaluated.
 * Unknown to the web client on purpose: it falls into the reconnect path. */
export const TRANSCRIPTION_GATE_UNAVAILABLE_CODE = 4503;

export type TranscriptionGateDecision = 'allow' | 'consent_required' | 'unavailable';

export async function evaluateTranscriptionGate(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
): Promise<TranscriptionGateDecision> {
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
    return 'unavailable';
  }
}

export async function enforceTranscriptionGate(
  client: Client,
  prisma: PrismaClient,
  tenantId: string | undefined,
  userId: string,
): Promise<boolean> {
  let decision: TranscriptionGateDecision;
  if (tenantId) {
    decision = await evaluateTranscriptionGate(prisma, tenantId, userId);
  } else {
    // Module loaded but no tenant id to evaluate against: fail closed.
    decision = getTranscriptionModuleSync() ? 'consent_required' : 'allow';
  }
  if (decision === 'allow') return false;

  if (decision === 'unavailable') {
    client.error(TRANSCRIPTION_GATE_UNAVAILABLE_CODE, 'transcription_gate_unavailable');
  } else {
    client.error(TRANSCRIPTION_CONSENT_REQUIRED_CODE, 'transcription_consent_required');
  }
  client.leave(1000);
  return true;
}
