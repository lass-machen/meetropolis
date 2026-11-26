import { logger } from '../../logger.js';
import { ACCESS_REVOKED_CHANNEL, PROCESS_ID } from '../../api/utils/broadcast.js';
import type { WorldRoom } from '../WorldRoom.js';

/**
 * Subscribe `room` to the single per-user access-revocation channel (published
 * by broadcastAccessRevoked after a member removal, an account deletion or a
 * guest revocation). The room's world-access registry decides per session, by
 * its own verified tenant, which clients must leave at once. Messages this
 * process published itself are skipped: the broadcaster already revoked its
 * rooms locally before publishing. Returns the unsubscribe function for
 * onDispose; a failed subscription rejects, so the room is never created
 * without its revocation channel.
 */
export async function subscribeAccessRevocations(room: WorldRoom): Promise<() => void> {
  const onRevoked = (message: { userId?: unknown; origin?: unknown }): void => {
    if (typeof message?.userId !== 'string') return;
    if (message?.origin === PROCESS_ID) return;
    room.worldAccess.revoke(message.userId).catch((e: unknown) => {
      logger.error('[WorldRoom] Failed to revoke world access', e);
    });
  };
  await room.presence.subscribe(ACCESS_REVOKED_CHANNEL, onRevoked);
  return () => {
    room.presence.unsubscribe(ACCESS_REVOKED_CHANNEL, onRevoked);
  };
}
