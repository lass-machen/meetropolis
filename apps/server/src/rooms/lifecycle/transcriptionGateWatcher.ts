import type { Client } from 'colyseus';
import { createPrismaClient } from '../../db.js';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import { getTranscriptionModuleSync, type TranscriptionGateChange } from '../../transcriptionLoader.js';
import type { WorldRoom } from '../WorldRoom.js';
import { isWorldAuth } from './onAuth.js';
import {
  evaluateTranscriptionJoin,
  TRANSCRIPTION_CONSENT_REQUIRED_CODE,
  type TranscriptionGateDecision,
} from './transcriptionGate.js';
import {
  beginTranscriptionGateCheck,
  isTranscriptionGateCheckCurrent,
  recordTranscriptionGateResult,
  revokeTranscriptionClearance,
} from './transcriptionClearance.js';
import { pushAllowListNowTo, scheduleAllowListPush } from '../audioZones/permissionOrchestrator.js';

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

// The client's clearance is already void, so the list pushed here holds no
// transcriber. It reaches the client before the error: a client that keeps
// its LiveKit session past the error would otherwise go on publishing to the
// transcriber with the last list it applied.
function disconnectForMissingConsent(room: WorldRoom, target: GateTarget): void {
  const { client } = target;
  try {
    pushAllowListNowTo(room, room.audioZones.tracker, client, target.userId);
  } catch (error) {
    logger.debug({ event: 'transcription.gate_allow_list_push_failed', error: String(error) });
  }
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

/**
 * Delays of the re-tries of a re-check that could not evaluate the gate. The
 * client stays without clearance meanwhile and, after the last one, until a
 * later gate change or its reconnect checks it again (fail-closed).
 */
export const GATE_RECHECK_RETRY_DELAYS_MS: readonly number[] = [1_000, 5_000, 15_000, 30_000, 60_000];

// The transcriber re-checks consent itself right before sending audio to the
// provider, so privacy does not depend on this disconnect. A failed evaluation
// must therefore never kick a user out of the world, it is only logged.
function logGateUnavailable(tenantId: string, userId: string, retryInMs: number | undefined): void {
  if (retryInMs === undefined) {
    logger.warn({ event: 'transcription.gate_recheck_given_up', tenantId, userId });
  } else {
    logger.warn({ event: 'transcription.gate_recheck_unavailable', tenantId, userId, retryInMs });
  }
}

// The client's allow-list follows its clearance, which the re-check just
// settled; a transcriber admission never precedes this point.
function repushAfterRecheck(room: WorldRoom, userId: string): void {
  scheduleAllowListPush(room.audioZones.orchestrator, room, room.audioZones.tracker, [userId]);
}

async function withPrisma<T>(room: WorldRoom, run: (prisma: PrismaClient) => Promise<T>): Promise<T> {
  const existingPrisma = room.prismaForPresence;
  const prisma = existingPrisma ?? createPrismaClient();
  try {
    return await run(prisma);
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

interface RecheckRun {
  tenantId: string;
  target: GateTarget;
  // The clearance generation the re-check began with, see transcriptionClearance.ts.
  generation: number;
}

async function recheckTarget(
  room: WorldRoom,
  prisma: PrismaClient,
  run: RecheckRun,
): Promise<TranscriptionGateDecision | 'superseded'> {
  const { tenantId, target, generation } = run;
  const { decision, consentVerified } = await evaluateTranscriptionJoin(prisma, tenantId, target.userId);
  // A later gate change superseded this verdict; its own re-check decides,
  // so a stale result neither clears nor disconnects.
  if (!recordTranscriptionGateResult(target.client, tenantId, consentVerified, generation)) return 'superseded';
  if (decision === 'consent_required') {
    disconnectForMissingConsent(room, target);
    return decision;
  }
  repushAfterRecheck(room, target.userId);
  return decision;
}

/** Re-runs re-checks the gate could not evaluate, with a bounded backoff. */
class GateRecheckRetries {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private stopped = false;

  constructor(private readonly room: WorldRoom) {}

  // `attempt` picks the delay: 0 after the re-check itself, one more per retry.
  afterUnavailable(run: RecheckRun, attempt: number): void {
    if (this.stopped) return;
    const delay = GATE_RECHECK_RETRY_DELAYS_MS[attempt];
    logGateUnavailable(run.tenantId, run.target.userId, delay);
    if (delay === undefined) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void this.retry(run, attempt + 1);
    }, delay);
    this.timers.add(timer);
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  // Ends without evaluating once the client left or a later gate change
  // superseded the re-check, which then runs on its own.
  private async retry(run: RecheckRun, attempt: number): Promise<void> {
    if (!this.room.clients.includes(run.target.client)) return;
    if (!isTranscriptionGateCheckCurrent(run.target.client, run.generation)) return;
    try {
      const outcome = await withPrisma(this.room, (prisma) => recheckTarget(this.room, prisma, run));
      if (outcome === 'unavailable') this.afterUnavailable(run, attempt);
    } catch (error) {
      logRecheckFailed(run.tenantId, error);
    }
  }
}

// Deliberately no disconnect on a failed re-check, see logGateUnavailable.
function logRecheckFailed(tenantId: string, error: unknown): void {
  logger.error({
    event: 'transcription.gate_recheck_failed',
    tenantId,
    error: error instanceof Error ? error.message : String(error),
  });
}

async function recheckTargets(
  room: WorldRoom,
  change: TranscriptionGateChange,
  targets: GateTarget[],
  retries: GateRecheckRetries,
): Promise<void> {
  await withPrisma(room, async (prisma) => {
    for (const target of targets) {
      const run = { tenantId: change.tenantId, target, generation: beginTranscriptionGateCheck(target.client) };
      if ((await recheckTarget(room, prisma, run)) === 'unavailable') retries.afterUnavailable(run, 0);
    }
  });
}

export function watchTranscriptionGate(room: WorldRoom): () => void {
  const transcriptionModule = getTranscriptionModuleSync();
  if (!transcriptionModule) return () => undefined;

  const retries = new GateRecheckRetries(room);
  const unsubscribe = transcriptionModule.onGateChange((change) => {
    const targets = getGateTargets(room, change);
    if (targets.length === 0) return;
    // The changed gate voids every target's clearance until its re-check
    // proved consent again; a push meanwhile keeps the transcriber out.
    for (const target of targets) revokeTranscriptionClearance(target.client);
    void recheckTargets(room, change, targets, retries).catch((error: unknown) =>
      logRecheckFailed(change.tenantId, error),
    );
  });
  return () => {
    unsubscribe();
    retries.stop();
  };
}
