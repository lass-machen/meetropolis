import { RoomServiceClient } from 'livekit-server-sdk';
import { logger } from '../../logger.js';
import { mapLivekitUrlToHttp } from '../audioZones/livekitAdmin.js';

/** Outcome of one privileged removal attempt: retry every `failed`. */
export type ConfirmedRemoval = 'removed' | 'absent' | 'failed';

/** Twirp `not_found` (or HTTP 404) proves the participant is already gone. */
function isAbsentError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === 'not_found') return true;
  return 'status' in error && error.status === 404;
}

/** Admin client for confirmed removals: 5 s request timeout via client options. */
function createConfirmedService(): RoomServiceClient | null {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const rawUrl = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !rawUrl) return null;
  return new RoomServiceClient(mapLivekitUrlToHttp(rawUrl), apiKey, apiSecret, { requestTimeout: 5 });
}

/**
 * Remove one participant with a confirmed outcome: `removed` after a
 * successful call, `absent` only for a `not_found` error or when the
 * participant is missing from the list, every other failure (timeout,
 * network, auth, missing credentials) is `failed`. Never throws.
 */
export async function removeParticipantConfirmed(
  roomName: string,
  identity: string,
): Promise<ConfirmedRemoval> {
  const client = createConfirmedService();
  if (!client) {
    logger.debug({ event: 'livekit.revoke_skipped', reason: 'not_configured', roomName });
    return 'failed';
  }
  try {
    const participants = await client.listParticipants(roomName);
    if (!participants.some((participant) => participant.identity === identity)) return 'absent';
  } catch (error: unknown) {
    if (isAbsentError(error)) return 'absent';
    logger.warn({ event: 'livekit.revoke_failed', roomName, error: errorText(error) });
    return 'failed';
  }
  try {
    await client.removeParticipant(roomName, identity);
    logger.info({ event: 'livekit.participant_removed', roomName, userId: identity });
    return 'removed';
  } catch (error: unknown) {
    if (isAbsentError(error)) return 'absent';
    logger.warn({ event: 'livekit.revoke_failed', roomName, error: errorText(error) });
    return 'failed';
  }
}

/**
 * Removes a user from the LiveKit calls of a tenant when the user loses access
 * to it. Disconnecting the world (Colyseus) does not end an AV call: the
 * LiveKit connection is separate and its access token stays valid until it
 * expires. LiveKit rooms of a tenant are named `<tenantSlug>:<room>` (see
 * /livekit/token in api/routes/health.ts) and the participant identity is the
 * user id.
 */

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
