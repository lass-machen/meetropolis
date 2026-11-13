import { logger } from '../../logger.js';
import { enqueueAvRevocation } from './avPendingRevocations.js';
import type { WorldAccessEntry } from './worldAccess.js';
import type { WorldRoom } from '../WorldRoom.js';

/**
 * Bounded access lease for joined world sessions. Every joined
 * entry carries `leaseUntil = min(now + WORLD_ACCESS_LEASE_MS,
 * accessExpiresAt ?? Infinity)`: a session the room can no longer verify
 * (revocation publish lost, database unreachable) ends at the latest when
 * the lease runs out, instead of staying until the next successful sweep.
 * A stored access deadline always wins over the lease window.
 */

/** Close/error code for a session whose access could not be re-verified. */
export const WORLD_ACCESS_UNVERIFIED_CODE = 4503;

const GUEST_EXPIRED_CODE = 4006;

const DEFAULT_SWEEP_MS = 30_000;
const DEFAULT_LEASE_MS = 120_000;
/** `setTimeout` throws above 2^31 - 1; cap the delay instead. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface WorldAccessTiming {
  sweepMs: number;
  leaseMs: number;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * Sweep and lease cadence from the environment. Non-numeric, non-positive
 * or non-integer values fall back to the defaults; a lease shorter than two
 * sweeps cannot renew in time, so both values fall back with a warning.
 */
export function resolveWorldAccessTiming(): WorldAccessTiming {
  const sweepMs = readPositiveInt('WORLD_ACCESS_SWEEP_MS', DEFAULT_SWEEP_MS);
  const leaseMs = readPositiveInt('WORLD_ACCESS_LEASE_MS', DEFAULT_LEASE_MS);
  if (leaseMs < 2 * sweepMs) {
    logger.warn({ event: 'world.access_timing_invalid', sweepMs, leaseMs });
    return { sweepMs: DEFAULT_SWEEP_MS, leaseMs: DEFAULT_LEASE_MS };
  }
  return { sweepMs, leaseMs };
}

/**
 * Stamp a fresh proof onto an entry. The lease ends at the earlier of
 * now plus the lease duration and `expiresAt` (omitted when there is no
 * deadline). Call it whenever an access check succeeded — the join gate,
 * the revocation handler and the sweep.
 */
export function applyAccessProof(entry: WorldAccessEntry, expiresAt: Date | null): void {
  const { leaseMs } = resolveWorldAccessTiming();
  const now = Date.now();
  const accessExpiresAt = expiresAt ? expiresAt.getTime() : null;
  entry.accessExpiresAt = accessExpiresAt;
  entry.leaseUntil = Math.min(now + leaseMs, accessExpiresAt ?? Number.POSITIVE_INFINITY);
}

const leaseTimers = new WeakMap<WorldRoom, ReturnType<typeof setTimeout>>();

export function clearWorldAccessLeaseTimer(room: WorldRoom): void {
  const timer = leaseTimers.get(room);
  if (timer !== undefined) {
    clearTimeout(timer);
    leaseTimers.delete(room);
  }
}

/** Best-effort reject: the client may already be gone. */
function disconnectLeaseEntry(room: WorldRoom, entry: WorldAccessEntry, code: number, reason: string): void {
  const client = room.clients.find((c) => c.sessionId === entry.sessionId);
  if (!client) return;
  try {
    client.error(code, reason);
  } catch {
    /* best-effort: the client may already be gone */
  }
  client.leave(1000);
}

/**
 * Room-local expiry pass, without any database access: every joined entry
 * whose lease ran out is disconnected. A stored access deadline that has
 * passed disconnects with 4006 `guest_expired`; anything else can no longer
 * be verified and disconnects with 4503 `access_unverified`. AV calls end
 * in both cases.
 */
export async function expireWorldAccessLeases(room: WorldRoom): Promise<void> {
  const now = Date.now();
  const expired = room.worldAccess.joined().filter((e) => e.leaseUntil !== null && e.leaseUntil <= now);
  for (const entry of expired) {
    if (entry.accessExpiresAt !== null && entry.accessExpiresAt <= now) {
      disconnectLeaseEntry(room, entry, GUEST_EXPIRED_CODE, 'guest_expired');
    } else {
      disconnectLeaseEntry(room, entry, WORLD_ACCESS_UNVERIFIED_CODE, 'access_unverified');
    }
    // Forget the entry at once, even when no client was found: otherwise it
    // stays joined until onLeave, the timer re-plans with no delay and the
    // disconnect repeats in a loop.
    room.worldAccess.forget(entry.sessionId);
    // Confirmed AV removal through the process-wide backlog (see worldAccess.ts).
    enqueueAvRevocation(`${entry.tenantSlug}:world`, entry.userId);
  }
}

/**
 * Plan the room's expiry pass at the earliest joined lease. Re-plan on
 * admit/renew/forget; the timer needs no database and is cleared on dispose.
 */
export function rescheduleWorldAccessLeaseTimer(room: WorldRoom): void {
  clearWorldAccessLeaseTimer(room);
  const now = Date.now();
  let earliest: number | null = null;
  for (const entry of room.worldAccess.joined()) {
    if (entry.leaseUntil === null) continue;
    if (earliest === null || entry.leaseUntil < earliest) earliest = entry.leaseUntil;
  }
  if (earliest === null) return;
  const delay = Math.min(Math.max(earliest - now, 0), MAX_TIMER_DELAY_MS);
  leaseTimers.set(
    room,
    setTimeout(() => {
      leaseTimers.delete(room);
      void expireWorldAccessLeases(room)
        .catch((e: unknown) => {
          logger.warn('[WorldRoom] Room access lease expiry failed', e);
        })
        .finally(() => {
          rescheduleWorldAccessLeaseTimer(room);
        });
    }, delay),
  );
}
