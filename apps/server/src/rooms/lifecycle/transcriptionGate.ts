import type { Client } from 'colyseus';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import { getTranscriptionModuleSync } from '../../transcriptionLoader.js';
import { recordTranscriptionGateResult } from './transcriptionClearance.js';

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
    recordTranscriptionGateResult(client, tenantId, decision === 'allow');
  } else {
    // Only reached when the caller's tenant lookup failed (NPCs return before the
    // limiter, and a tenant-less join with a successful lookup skips the gate).
    // With the module loaded there is nothing to evaluate against: fail closed.
    decision = getTranscriptionModuleSync() ? 'unavailable' : 'allow';
    if (decision === 'unavailable') {
      logger.warn({ event: 'transcription.gate_tenant_unresolved', userId });
    }
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
