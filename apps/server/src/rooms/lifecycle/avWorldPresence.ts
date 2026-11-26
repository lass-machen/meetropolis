import type { WorldRoom } from '../WorldRoom.js';
import type { WorldAccessEntry } from './worldAccess.js';

export interface AvWorldPresenceSubject {
  userId: string;
  authSessionId: string;
  tenantId: string;
  tenantSlug: string;
}

export interface AvWorldPresenceProof {
  room: WorldRoom;
  colyseusSessionId: string;
  entry: WorldAccessEntry;
  epoch: number;
  subject: AvWorldPresenceSubject;
}

function isFiniteFuture(value: number | null, now: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > now;
}

function isCompleteSubject(subject: AvWorldPresenceSubject): boolean {
  return (
    typeof subject.userId === 'string' &&
    subject.userId.length > 0 &&
    typeof subject.authSessionId === 'string' &&
    subject.authSessionId.length > 0 &&
    typeof subject.tenantId === 'string' &&
    subject.tenantId.length > 0 &&
    typeof subject.tenantSlug === 'string' &&
    subject.tenantSlug.length > 0
  );
}

function snapshotSubject(subject: AvWorldPresenceSubject): AvWorldPresenceSubject {
  return {
    userId: subject.userId,
    authSessionId: subject.authSessionId,
    tenantId: subject.tenantId,
    tenantSlug: subject.tenantSlug,
  };
}

function entryMatches(entry: WorldAccessEntry, subject: AvWorldPresenceSubject): boolean {
  return (
    entry.userId === subject.userId &&
    entry.tenantId === subject.tenantId &&
    entry.tenantSlug === subject.tenantSlug &&
    entry.authSessionId === subject.authSessionId
  );
}

function roomCandidates(room: WorldRoom, subject: AvWorldPresenceSubject, now: number): AvWorldPresenceProof[] {
  const found: AvWorldPresenceProof[] = [];
  const registry = room.worldAccess;
  if (!registry) return found;
  const clients = room.clients ?? [];
  const players = room.state?.players;
  if (!players) return found;
  for (const client of clients) {
    const sessionId = client?.sessionId;
    if (typeof sessionId !== 'string' || sessionId.length === 0) continue;
    const player = players.get(sessionId) as { identity?: unknown; isNpc?: unknown } | undefined;
    if (!player || player.identity !== subject.userId || player.isNpc === true) continue;
    const entry = registry.entryFor(sessionId);
    if (!entry || entry.sessionId !== sessionId) continue;
    if (!entryMatches(entry, subject)) continue;
    if (!isFiniteFuture(entry.leaseUntil, now)) continue;
    if (entry.accessExpiresAt !== null && !isFiniteFuture(entry.accessExpiresAt, now)) continue;
    found.push({ room, colyseusSessionId: sessionId, entry, epoch: entry.epoch, subject: snapshotSubject(subject) });
  }
  return found;
}

function collectMatches(subject: AvWorldPresenceSubject, now: number): AvWorldPresenceProof[] {
  const rooms = globalThis.activeWorldRooms;
  if (!rooms || rooms.size === 0) return [];
  const matches: AvWorldPresenceProof[] = [];
  for (const room of rooms) {
    if (!room) continue;
    matches.push(...roomCandidates(room, subject, now));
  }
  return matches;
}

/**
 * Narrow read over the live world registration: exactly one materialized
 * human world session for the verified login session, user, tenant id and
 * tenant slug. Returns a proof pinning the room, Colyseus session id, entry
 * object, epoch and a primitive snapshot of the checked subject, or null
 * when presence is absent or ambiguous.
 */
export function resolveAvWorldPresence(
  subject: AvWorldPresenceSubject,
  now: number = Date.now(),
): AvWorldPresenceProof | null {
  if (!isCompleteSubject(subject)) return null;
  const matches = collectMatches(subject, now);
  if (matches.length !== 1) return null;
  return matches[0];
}

/**
 * Re-confirms a proof against the originally pinned subject binding
 * immediately before use: the same room registration, Colyseus session id,
 * entry object and epoch must still hold, the entry must still match the
 * pinned subject snapshot, and no second matching session may exist
 * anywhere. A new presence, mutation, loss, lease lapse or re-registration
 * fails, even when another matching presence exists.
 */
export function isAvWorldPresenceCurrent(
  proof: AvWorldPresenceProof | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!proof) return false;
  if (!isCompleteSubject(proof.subject)) return false;
  const matches = collectMatches(proof.subject, now);
  if (matches.length !== 1) return false;
  const only = matches[0];
  return (
    only.room === proof.room &&
    only.colyseusSessionId === proof.colyseusSessionId &&
    only.entry === proof.entry &&
    only.epoch === proof.epoch
  );
}
