import type { Client } from 'colyseus';
import { createPrismaClient } from '../../db.js';
import { logger } from '../../logger.js';
import { getTranscriptionModuleSync, type TranscriptionGateChange } from '../../transcriptionLoader.js';
import type { WorldRoom } from '../WorldRoom.js';
import { isWorldAuth } from './onAuth.js';
import { evaluateTranscriptionGate, TRANSCRIPTION_CONSENT_REQUIRED_CODE } from './transcriptionGate.js';

interface GateTarget {
  client: Client;
  userId: string;
}

function getGateTargets(room: WorldRoom, change: TranscriptionGateChange): GateTarget[] {
  const targets: GateTarget[] = [];
  for (const client of room.clients) {
    if (!isWorldAuth(client.auth)) continue;
    if (client.auth.isNpc || client.auth.tenantId !== change.tenantId) continue;
    if (change.userId && client.auth.identity !== change.userId) continue;
    targets.push({ client, userId: client.auth.identity });
  }
  return targets;
}

function disconnectForMissingConsent(client: Client): void {
  try {
    client.error(TRANSCRIPTION_CONSENT_REQUIRED_CODE, 'transcription_consent_required');
  } catch (error) {
    logger.debug({ event: 'transcription.gate_error_send_failed', error: String(error) });
  }
  try {
    client.leave(TRANSCRIPTION_CONSENT_REQUIRED_CODE);
  } catch (error) {
    logger.debug({ event: 'transcription.gate_leave_failed', error: String(error) });
  }
}

async function recheckTargets(room: WorldRoom, change: TranscriptionGateChange, targets: GateTarget[]): Promise<void> {
  const existingPrisma = room.prismaForPresence;
  const prisma = existingPrisma ?? createPrismaClient();
  try {
    for (const target of targets) {
      const decision = await evaluateTranscriptionGate(prisma, change.tenantId, target.userId);
      if (decision === 'consent_required') disconnectForMissingConsent(target.client);
    }
  } finally {
    if (!existingPrisma) {
      try {
        await prisma.$disconnect();
      } catch (error) {
        logger.debug({ event: 'transcription.gate_prisma_disconnect_failed', error: String(error) });
      }
    }
  }
}

export function watchTranscriptionGate(room: WorldRoom): () => void {
  const transcriptionModule = getTranscriptionModuleSync();
  if (!transcriptionModule) return () => undefined;

  return transcriptionModule.onGateChange((change) => {
    const targets = getGateTargets(room, change);
    if (targets.length === 0) return;
    void recheckTargets(room, change, targets).catch((error: unknown) => {
      logger.error({
        event: 'transcription.gate_recheck_failed',
        tenantId: change.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      for (const target of targets) disconnectForMissingConsent(target.client);
    });
  });
}
