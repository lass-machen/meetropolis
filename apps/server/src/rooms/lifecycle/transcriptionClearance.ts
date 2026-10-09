/**
 * Per-client proof that the transcription consent gate checked the user's
 * consent and found it valid.
 *
 * `getJoinRequirement` answers `null` both for a tenant without running
 * transcription and for a consenting user of a tenant with it, so an `allow`
 * alone proves no consent. The proof is the module's explicit verdict
 * (`evaluateJoin().consentVerified`); a module without it clears nobody. The
 * SFU allow-list admits the transcriber only for a client holding this
 * clearance and only while its tenant is active
 * (audioZones/transcriberAdmission.ts).
 *
 * A gate change voids the clearance of every client it targets until the
 * re-check proved consent again (transcriptionGateWatcher.ts), so a tenant
 * that switches transcription on never reaches a client that has not been
 * checked against the running gate.
 */

import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import { getTranscriptionModuleSync } from '../../transcriptionLoader.js';

// Fail-closed read of the module's optional synchronous tenant state: no
// module, no method or a throwing module all mean "not active".
export function isTenantTranscriptionActive(tenantId: string): boolean {
  const transcriptionModule = getTranscriptionModuleSync();
  if (!transcriptionModule?.isTenantTranscriptionActive) return false;
  try {
    return transcriptionModule.isTenantTranscriptionActive(tenantId) === true;
  } catch (error) {
    logger.warn({
      event: 'transcription.tenant_state_check_failed',
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// Keyed by the Colyseus client object, so a reconnect (new client) starts
// without clearance and a departed client is collected with its entry.
const clearedTenantByClient = new WeakMap<Client, string>();

export function recordTranscriptionGateResult(client: Client, tenantId: string, consentVerified: boolean): void {
  if (consentVerified) clearedTenantByClient.set(client, tenantId);
  else clearedTenantByClient.delete(client);
}

export function revokeTranscriptionClearance(client: Client): void {
  clearedTenantByClient.delete(client);
}

export function hasTranscriptionClearance(client: Client, tenantId: string): boolean {
  return clearedTenantByClient.get(client) === tenantId;
}
