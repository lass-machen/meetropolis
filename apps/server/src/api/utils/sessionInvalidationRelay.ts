import type { Presence } from '@colyseus/core';
import { logger } from '../../logger.js';
import { PROCESS_ID } from './broadcast.js';
import { applySessionInvalidation, setSessionInvalidationPublisher, type SessionInvalidation } from './sessionCache.js';

/** Presence channel that carries session invalidations between processes. */
export const SESSION_INVALIDATED_CHANNEL = 'session_invalidated';

type SessionInvalidationMessage = SessionInvalidation & { origin: string };

function parseMessage(message: unknown): SessionInvalidationMessage | null {
  if (typeof message !== 'object' || message === null) return null;
  const candidate = message as Record<string, unknown>;
  if (typeof candidate.origin !== 'string' || candidate.origin.length === 0) return null;
  if (candidate.kind === 'token' && typeof candidate.tokenHash === 'string') {
    return { kind: 'token', tokenHash: candidate.tokenHash, origin: candidate.origin };
  }
  if (candidate.kind === 'user' && typeof candidate.userId === 'string') {
    return { kind: 'user', userId: candidate.userId, origin: candidate.origin };
  }
  return null;
}

/**
 * Install the cross-process session-invalidation relay for this process.
 *
 * The relay owns exactly one presence subscription per process, not one per
 * room: room-scoped subscriptions (as in accessRevocation.ts) only reach
 * processes that currently host an active room, so a process without a room
 * would keep serving revoked sessions from its cache until the TTL expired.
 * Installed once at startup, this subscription reaches every process.
 *
 * Local invalidations are published with this process's `origin`; incoming
 * messages with that same origin are ignored because the local cache was
 * already updated before publishing. Returns a function that removes the
 * subscription and the publisher again.
 */
export function installSessionInvalidationRelay(presence: Presence, origin: string = PROCESS_ID): () => void {
  const onMessage = (message: unknown): void => {
    const parsed = parseMessage(message);
    if (!parsed || parsed.origin === origin) return;
    applySessionInvalidation(parsed);
  };

  setSessionInvalidationPublisher((event: SessionInvalidation) => {
    const logFailure = (e: unknown): void => {
      logger.warn({
        event: 'auth.session.invalidation_relay_publish_failed',
        kind: event.kind,
        error: e instanceof Error ? e.message : String(e),
      });
    };
    try {
      Promise.resolve(presence.publish(SESSION_INVALIDATED_CHANNEL, { ...event, origin })).catch(logFailure);
    } catch (e: unknown) {
      logFailure(e);
    }
  });

  try {
    Promise.resolve(presence.subscribe(SESSION_INVALIDATED_CHANNEL, onMessage)).catch((e: unknown) => {
      logger.warn({
        event: 'auth.session.invalidation_relay_subscribe_failed',
        error: e instanceof Error ? e.message : String(e),
      });
    });
  } catch (e: unknown) {
    logger.warn({
      event: 'auth.session.invalidation_relay_subscribe_failed',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return () => {
    try {
      Promise.resolve(presence.unsubscribe(SESSION_INVALIDATED_CHANNEL, onMessage)).catch((e: unknown) => {
        logger.warn({
          event: 'auth.session.invalidation_relay_unsubscribe_failed',
          error: e instanceof Error ? e.message : String(e),
        });
      });
    } catch (e: unknown) {
      logger.warn({
        event: 'auth.session.invalidation_relay_unsubscribe_failed',
        error: e instanceof Error ? e.message : String(e),
      });
    }
    setSessionInvalidationPublisher(undefined);
  };
}
