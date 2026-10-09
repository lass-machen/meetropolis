/**
 * Whether the transcriber (`svc-transcriber`) may join one publisher's SFU
 * allow-list, i.e. subscribe to that publisher's tracks.
 *
 * The publisher-set allow-list is the H4 SFU-hard boundary (see
 * permissionOrchestrator.ts), so it also has to be the boundary for the
 * transcriber: a hidden subscriber with `canSubscribe` is still refused by
 * LiveKit unless the publisher lists it. The transcriber is admitted only
 * when all of these hold, anything else keeps the pre-transcription
 * allow-list:
 *
 * - the transcription module is loaded;
 * - the publisher's Colyseus client carries a JWT-verified tenant (no NPC,
 *   no token-less join) and that tenant is this room's tenant. Its join then
 *   passed the consent gate of exactly this tenant (onJoin.limiter.ts ->
 *   enforceTranscriptionGate, close code 4008), and transcriptionGateWatcher
 *   re-checks it on every gate change. A publisher whose verified tenant
 *   differs from the room's was checked against another tenant and stays
 *   excluded;
 * - the module reports that tenant's transcription as active, read
 *   synchronously from state the module keeps (no database access here).
 *
 * The isolated-island rule needs the island and lives in buildPushPayloads.
 */

import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import { getTranscriptionModuleSync, type TranscriptionModule } from '../../transcriptionLoader.js';
import type { WorldRoom } from '../WorldRoom.js';
import { getRoomTenantSlug } from '../handlers/zoneLockHandler.js';
import { isWorldAuth } from '../lifecycle/onAuth.js';

export type TranscriberAdmission = (publisherIdentity: string) => boolean;

export const NO_TRANSCRIBER: TranscriberAdmission = () => false;

// A throwing module must not break the push batch; it counts as inactive.
function readTenantActive(transcriptionModule: TranscriptionModule, tenantId: string): boolean {
  try {
    return transcriptionModule.isTenantTranscriptionActive?.(tenantId) === true;
  } catch (error) {
    logger.warn({
      event: 'transcription.tenant_state_check_failed',
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// Built once per push batch: the tenant state is read at most once per
// tenant and batch, and every batch reads it afresh, so the reconciler's
// periodic repush picks up a state change even without a gate event.
export function transcriberAdmissionFor(
  room: WorldRoom,
  clientOf: (identity: string) => Client | undefined,
): TranscriberAdmission {
  // No module, or a module without the optional synchronous state: the
  // allow-lists stay exactly as without transcription.
  const transcriptionModule = getTranscriptionModuleSync();
  if (!transcriptionModule?.isTenantTranscriptionActive) return NO_TRANSCRIBER;

  const roomTenantSlug = getRoomTenantSlug(room);
  const activeByTenant = new Map<string, boolean>();
  return (publisherIdentity) => {
    const auth: unknown = clientOf(publisherIdentity)?.auth;
    if (!isWorldAuth(auth) || auth.isNpc || !auth.tenantId) return false;
    if (auth.tenantSlug !== roomTenantSlug) return false;

    let active = activeByTenant.get(auth.tenantId);
    if (active === undefined) {
      active = readTenantActive(transcriptionModule, auth.tenantId);
      activeByTenant.set(auth.tenantId, active);
    }
    return active;
  };
}
