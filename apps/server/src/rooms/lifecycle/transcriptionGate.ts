import type { Client } from 'colyseus';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import { getTranscriptionModuleSync } from '../../transcriptionLoader.js';

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
  tenantId: string,
  userId: string,
): Promise<boolean> {
  if ((await evaluateTranscriptionGate(prisma, tenantId, userId)) === 'allow') return false;

  client.error(4006, 'transcription_consent_required');
  client.leave(1000);
  return true;
}
