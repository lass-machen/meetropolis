import { logger } from '../../logger.js';
import { createPrismaClient } from '../../db.js';
import { revokeSessionsForUser } from '../../api/utils/sessionAuth.js';
import type { PrismaClient } from '../../generated/prisma/index.js';
import {
  classifyDeniedAccess,
  denialClose,
  readWorldAccess,
  type WorldAccessDenial,
  type WorldAccessEntry,
} from './worldAccess.js';
import { applyAccessProof, rescheduleWorldAccessLeaseTimer, resolveWorldAccessTiming } from './worldAccessLease.js';
import { enqueueAvRevocation } from './avPendingRevocations.js';
import type { WorldRoom } from '../WorldRoom.js';

/** Disconnect one joined session; the AV call ends separately below. */
function disconnectSession(room: WorldRoom, sessionId: string, code: number, reason: string): void {
  const client = room.clients.find((c) => c.sessionId === sessionId);
  if (!client) return;
  try {
    client.error(code, reason);
  } catch {
    /* best-effort: the client may already be gone */
  }
  client.leave(1000);
}

async function denialOf(prisma: PrismaClient, entry: WorldAccessEntry): Promise<WorldAccessDenial> {
  try {
    return await classifyDeniedAccess(prisma, entry.userId, entry.tenantId, entry.authSessionId);
  } catch (e) {
    logger.warn({
      event: 'world.access_revoked_check_failed',
      userId: entry.userId,
      tenantId: entry.tenantId,
      error: String(e),
    });
    return 'not_member_of_tenant';
  }
}

/** Proven denial: disconnect, and drop an expired guest's sessions so the
 * cached token cannot walk back in. Never called for a successful proof. */
async function disconnectDenied(room: WorldRoom, prisma: PrismaClient, entry: WorldAccessEntry): Promise<void> {
  const reason = await denialOf(prisma, entry);
  const close = denialClose(reason);
  disconnectSession(room, entry.sessionId, close.code, close.message);
  if (reason === 'guest_expired') {
    await revokeSessionsForUser(prisma, entry.userId).catch(() => {
      /* best-effort */
    });
  } else if (reason === 'not_member_of_tenant') {
    logger.warn({ event: 'world.access_revoked', tenantId: entry.tenantId, userId: entry.userId });
  }
  // Confirmed AV removal through the process-wide backlog (see worldAccess.ts).
  enqueueAvRevocation(`${entry.tenantSlug}:world`, entry.userId);
}

/**
 * Re-read every joined seat. Proofs are applied only after every read
 * returned; a database error renews nothing and disconnects nobody (the
 * lease still ends the seat). A missing session or a failed access proof
 * disconnects and is never renewed.
 */
async function sweepJoinedAccess(room: WorldRoom): Promise<void> {
  const prisma = room.prismaForPresence ?? createPrismaClient();
  const joined = room.worldAccess.joined();
  const checks: Array<{ entry: WorldAccessEntry; ok: boolean; expiresAt: Date | null }> = [];
  for (const entry of joined) {
    const check = await readWorldAccess(prisma, entry.userId, entry.tenantId, entry.authSessionId);
    checks.push({ entry, ok: check.ok, expiresAt: check.expiresAt });
  }
  for (const item of checks) {
    if (item.ok) {
      applyAccessProof(item.entry, item.expiresAt);
      continue;
    }
    await disconnectDenied(room, prisma, item.entry);
  }
  rescheduleWorldAccessLeaseTimer(room);
}

// Periodic access check of a world room, every WORLD_ACCESS_SWEEP_MS
// (default 30 s): each joined human seat is re-proven with its stored
// database session id. Failed proofs disconnect. Seats that keep access
// get a fresh lease (see worldAccessLease.ts). A failed sweep renews nothing.
export function startGuestExpiryInterval(room: WorldRoom): ReturnType<typeof setInterval> {
  return setInterval(() => {
    void sweepJoinedAccess(room).catch((e: unknown) => {
      logger.warn('[WorldRoom] Room access sweep failed', e);
    });
  }, resolveWorldAccessTiming().sweepMs);
}
