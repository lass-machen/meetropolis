import { ServerError, type Client } from '@colyseus/core';
import { logger } from '../../logger.js';
import { createPrismaClient } from '../../db.js';
import { hasTenantAccess } from '../../api/utils/tenantMembership.js';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { AUTH_REJECTED_CODE, type WorldAuth } from './onAuth.js';
import { enqueueAvRevocation } from './avPendingRevocations.js';
import { applyAccessProof, rescheduleWorldAccessLeaseTimer } from './worldAccessLease.js';
import type { Player, WorldRoom } from '../WorldRoom.js';

/** Distinct close/error code for an expired guest (matches checkGuestExpired). */
const GUEST_EXPIRED_CODE = 4006;

/**
 * Per-client world access: every human client the room accepted is
 * tracked with its VERIFIED tenant, so revocation and the access sweep check
 * the tenant the session belongs to — never the room slug.
 *
 * An entry counts as joined when `room.state.players` holds its sessionId,
 * else as joining; there is no separate state flag (`completePendingJoin`
 * owns the player map). NPC joins carry no tenant and get no entry.
 */

type AccessPrisma = Pick<PrismaClient, 'membership' | 'tenant' | 'session'>;

export interface WorldAccessEntry {
  sessionId: string;
  userId: string;
  tenantId: string;
  tenantSlug: string;
  /** Database session id from `WorldAuth.sessionId`. Null fails closed. */
  authSessionId: string | null;
  epoch: number;
  leaseUntil: number | null;
  accessExpiresAt: number | null;
}

export type WorldAccessCheck = { ok: boolean; expiresAt: Date | null };

export type WorldAccessDenial = 'session_revoked' | 'guest_expired' | 'not_member_of_tenant';

/**
 * Database session id carried on `WorldAuth`. `sessionId` wins. The optional
 * bridge field is the same id for callers that have not moved yet.
 */
function sessionIdFromAuth(auth: WorldAuth): string | null {
  if (typeof auth.sessionId === 'string' && auth.sessionId.length > 0) return auth.sessionId;
  if (typeof auth.authSessionId === 'string' && auth.authSessionId.length > 0) return auth.authSessionId;
  return null;
}

/** Session row for this id and user, still in the future. Missing or mismatched fails closed. */
async function loadBoundSession(
  prisma: AccessPrisma,
  userId: string,
  sessionId: string | null,
): Promise<{ expiresAt: Date } | null> {
  if (!sessionId) return null;
  const now = new Date();
  const rows = await prisma.session.findMany({
    where: { id: { in: [sessionId] }, userId, expiresAt: { gt: now } },
    select: { id: true, userId: true, expiresAt: true },
  });
  const row = rows.find((candidate) => candidate.id === sessionId && candidate.userId === userId);
  if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
  return { expiresAt: row.expiresAt };
}

/**
 * Deadline only. A membership expiry that is already past is not applied:
 * `hasTenantAccess` has already allowed the subject, and the past date must
 * not take the seat away. No membership expiry leaves the session expiry.
 */
function accessDeadline(membershipExpiresAt: Date | null, sessionExpiresAt: Date): Date {
  if (membershipExpiresAt === null) return sessionExpiresAt;
  if (membershipExpiresAt.getTime() <= Date.now()) return sessionExpiresAt;
  const sessionMs = sessionExpiresAt.getTime();
  return membershipExpiresAt.getTime() < sessionMs ? membershipExpiresAt : sessionExpiresAt;
}

/**
 * Fresh proof for `userId` in `tenantId` on `sessionId`. Grant is only
 * `hasTenantAccess`. The session row must exist, belong to `userId` and still
 * be open. `expiresAt` is the earlier of that session expiry and a still-open
 * membership expiry, and is never itself a grant. Database errors propagate.
 * A missing row is `{ ok: false }`.
 */
export async function readWorldAccess(
  prisma: AccessPrisma,
  userId: string,
  tenantId: string,
  sessionId: string | null,
): Promise<WorldAccessCheck> {
  const session = await loadBoundSession(prisma, userId, sessionId);
  if (!session) return { ok: false, expiresAt: null };
  if (!(await hasTenantAccess(prisma, userId, tenantId))) return { ok: false, expiresAt: null };
  const membership = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: { expiresAt: true },
  });
  return { ok: true, expiresAt: accessDeadline(membership?.expiresAt ?? null, session.expiresAt) };
}

/** Why a failed proof ends the seat. Not a second grant. */
export async function classifyDeniedAccess(
  prisma: AccessPrisma,
  userId: string,
  tenantId: string,
  sessionId: string | null,
): Promise<WorldAccessDenial> {
  const session = await loadBoundSession(prisma, userId, sessionId);
  if (!session) return 'session_revoked';
  const membership = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: { role: true, expiresAt: true },
  });
  const guestLapsed =
    membership?.role === 'guest' && membership.expiresAt !== null && membership.expiresAt.getTime() <= Date.now();
  if (guestLapsed) return 'guest_expired';
  return 'not_member_of_tenant';
}

export function denialClose(reason: WorldAccessDenial): { code: number; message: string } {
  if (reason === 'guest_expired') return { code: GUEST_EXPIRED_CODE, message: 'guest_expired' };
  if (reason === 'session_revoked') return { code: AUTH_REJECTED_CODE, message: 'session_revoked' };
  return { code: AUTH_REJECTED_CODE, message: 'not_member_of_tenant' };
}

async function deniedReason(prisma: AccessPrisma, entry: WorldAccessEntry): Promise<WorldAccessDenial> {
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

export class WorldAccessRegistry {
  private readonly entries = new Map<string, WorldAccessEntry>();

  constructor(private readonly room: WorldRoom) {}

  /**
   * Track a verified human join; NPC joins get no entry. Fail-closed.
   * Supplements a pending entry left by `registerPending` (keeps its epoch,
   * so a revocation that arrived mid-join survives); creates a fresh entry
   * (epoch 0) when there is none.
   */
  register(sessionId: string, auth: WorldAuth): void {
    if (auth.isNpc) return;
    if (!auth.tenantId || !auth.tenantSlug) {
      throw new ServerError(AUTH_REJECTED_CODE, 'tenant_unresolved');
    }
    const provenSessionId = sessionIdFromAuth(auth);
    const pending = this.entries.get(sessionId);
    if (pending) {
      pending.userId = auth.identity;
      pending.tenantId = auth.tenantId;
      pending.tenantSlug = auth.tenantSlug;
      pending.authSessionId = provenSessionId ?? pending.authSessionId;
      return;
    }
    this.entries.set(sessionId, {
      sessionId,
      userId: auth.identity,
      tenantId: auth.tenantId,
      tenantSlug: auth.tenantSlug,
      authSessionId: provenSessionId,
      epoch: 0,
      leaseUntil: null,
      accessExpiresAt: null,
    });
  }

  /**
   * Preliminary entry for a session whose token just verified, before its
   * tenant membership was proven. Carries no tenant slug yet; `register`
   * completes it after the full authentication. Never resets the epoch, and
   * never throws: a failed insert must not break the join it protects.
   */
  registerPending(sessionId: string, userId: string, tenantId: string | undefined): void {
    const existing = this.entries.get(sessionId);
    if (existing) {
      existing.userId = userId;
      if (tenantId) existing.tenantId = tenantId;
      return;
    }
    this.entries.set(sessionId, {
      sessionId,
      userId,
      tenantId: tenantId ?? '',
      tenantSlug: '',
      authSessionId: null,
      epoch: 0,
      leaseUntil: null,
      accessExpiresAt: null,
    });
  }

  /** Raw entry lookup for the join gate; the epoch comparison pins it. */
  entryFor(sessionId: string): WorldAccessEntry | undefined {
    return this.entries.get(sessionId);
  }

  /**
   * True once the session's player is published — and only then — so
   * confidential sends after `players.set` can re-check it right before
   * `client.send`. NPC players have no entry and always pass.
   */
  isJoined(sessionId: string): boolean {
    const player = this.room.state.players.get(sessionId);
    if (!player) return false;
    if (player.isNpc) return true;
    return this.entries.has(sessionId);
  }

  forget(sessionId: string): void {
    this.entries.delete(sessionId);
    rescheduleWorldAccessLeaseTimer(this.room);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Entries whose session already published its player (joined, not joining). */
  joined(): WorldAccessEntry[] {
    return [...this.entries.values()].filter((e) => this.room.state.players.has(e.sessionId));
  }

  private disconnect(sessionId: string, code: number, reason: string): void {
    const client = this.room.clients.find((c) => c.sessionId === sessionId);
    if (!client) return;
    try {
      client.error(code, reason);
    } catch {
      /* best-effort: the client may already be gone */
    }
    client.leave(1000);
  }

  /** Re-prove one joined entry. True when the lease was renewed.
   * A database error renews nothing and leaves the current lease in place. */
  private async reprove(prisma: AccessPrisma, entry: WorldAccessEntry): Promise<boolean> {
    let check: WorldAccessCheck;
    try {
      check = await readWorldAccess(prisma, entry.userId, entry.tenantId, entry.authSessionId);
    } catch (e) {
      logger.warn({
        event: 'world.access_revoked_check_failed',
        userId: entry.userId,
        tenantId: entry.tenantId,
        error: String(e),
      });
      return false;
    }
    if (check.ok) {
      applyAccessProof(entry, check.expiresAt);
      return true;
    }
    const close = denialClose(await deniedReason(prisma, entry));
    this.disconnect(entry.sessionId, close.code, close.message);
    // Confirmed AV removal: the world send ends at once, the call ends once
    // the backlog proves it. The process-wide backlog survives leave/dispose.
    enqueueAvRevocation(`${entry.tenantSlug}:world`, entry.userId);
    return false;
  }

  /** Per-user revocation: bump every entry of `userId`, then re-prove each JOINED
   * session against its stored database session id and verified tenant. A failed
   * proof disconnects and leaves the tenant calls. A database error renews
   * nothing; the lease still ends the seat. */
  async revoke(userId: string): Promise<void> {
    const owned = [...this.entries.values()].filter((e) => e.userId === userId);
    if (owned.length === 0) return;
    for (const entry of owned) entry.epoch += 1;
    const prisma = this.room.prismaForPresence ?? createPrismaClient();
    let renewed = false;
    for (const entry of owned) {
      if (!this.room.state.players.has(entry.sessionId)) continue;
      if (await this.reprove(prisma, entry)) renewed = true;
    }
    if (renewed) rescheduleWorldAccessLeaseTimer(this.room);
  }
}

export function createWorldAccess(room: WorldRoom): WorldAccessRegistry {
  return new WorldAccessRegistry(room);
}

/** Best-effort reject: the client may already be gone. */
function rejectJoin(room: WorldRoom, client: Client, code: number, reason: string): void {
  try {
    client.error(code, reason);
  } catch {
    /* best-effort: the client may already be gone */
  }
  room.worldAccess.forget(client.sessionId);
  client.leave(1000);
}

/**
 * Final access proof before a joining player becomes visible
 * (`completePendingJoin` calls this instead of setting the player directly).
 * Snapshots the entry epoch, re-proves `hasTenantAccess` and the stored
 * database session id, then — synchronously, without another `await` —
 * publishes the player only when the entry still exists, its epoch is
 * unchanged and the proof holds. Anything else rejects the join fail-closed
 * (a database error too). A published player carries a fresh access lease
 * (see worldAccessLease.ts). Returns true when the player was published.
 */
export async function admitPlayer(room: WorldRoom, client: Client, player: Player): Promise<boolean> {
  if (player.isNpc) {
    room.state.players.set(client.sessionId, player);
    return true;
  }
  const entry = room.worldAccess.entryFor(client.sessionId);
  if (!entry) {
    rejectJoin(room, client, AUTH_REJECTED_CODE, 'not_member_of_tenant');
    return false;
  }
  const epoch = entry.epoch;
  const prisma = room.prismaForPresence ?? createPrismaClient();
  let check: WorldAccessCheck;
  try {
    check = await readWorldAccess(prisma, entry.userId, entry.tenantId, entry.authSessionId);
  } catch {
    rejectJoin(room, client, AUTH_REJECTED_CODE, 'not_member_of_tenant');
    return false;
  }
  const current = room.worldAccess.entryFor(client.sessionId);
  if (current && current.epoch === epoch && check.ok) {
    room.state.players.set(client.sessionId, player);
    applyAccessProof(current, check.expiresAt);
    rescheduleWorldAccessLeaseTimer(room);
    return true;
  }
  const close = denialClose(await deniedReason(prisma, entry));
  rejectJoin(room, client, close.code, close.message);
  return false;
}
