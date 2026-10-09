/**
 * Debounced Colyseus push of `av_zone_permissions { islandId, allow }`.
 *
 * This is the transport for the SFU-hard boundary: the receiving client
 * is expected to call LiveKit's `localParticipant.setTrackSubscriptionPermissions`
 * with the pushed allow-list, which only the publisher itself can set.
 * This module never talks to LiveKit directly — it only tells each
 * affected participant who is currently allowed to subscribe to them.
 * Besides island members, the only identity a list can carry is the
 * transcriber, under the rules in transcriberAdmission.ts.
 *
 * Batching: a participant can appear in several transitions within the
 * same movement tick (their own move, or a peer's move putting them in
 * the affected set). All pending identities are flushed together after
 * one BATCH_WINDOW_MS window, so a burst of group movement produces at
 * most one push per identity instead of a push storm.
 */

import type { Client } from 'colyseus';
import type { WorldRoom } from '../WorldRoom.js';
import { allowListFor, isIsolatedIsland, type IslandSnapshot } from './islandModel.js';
import { TRANSCRIBER_IDENTITY } from './islandAttributes.js';
import { snapshot, type MembershipTracker } from './membershipTracker.js';
import { NO_TRANSCRIBER, transcriberAdmissionFor, type TranscriberAdmission } from './transcriberAdmission.js';

export interface PermissionOrchestrator {
  pending: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface ZonePermissionPayload {
  identity: string;
  islandId: string;
  allow: string[];
}

const BATCH_WINDOW_MS = Number(process.env.AUDIO_ZONE_PUSH_BATCH_MS ?? 100);

export function createPermissionOrchestrator(): PermissionOrchestrator {
  return { pending: new Set(), timer: null };
}

// Pure: computes what each affected identity's next push should contain.
// Skips identities absent from the snapshot (departed before the batch
// window elapsed) rather than sending a stale/empty payload.
// The transcriber is never an island member; it is appended for an admitted
// publisher (see transcriberAdmission.ts) unless that publisher sits on an
// isolated island, which is shared by nobody and so holds no conversation.
export function buildPushPayloads(
  identities: Iterable<string>,
  snap: IslandSnapshot,
  admitsTranscriber: TranscriberAdmission = NO_TRANSCRIBER,
): ZonePermissionPayload[] {
  const out: ZonePermissionPayload[] = [];
  for (const identity of identities) {
    const island = snap.get(identity);
    if (!island) continue;
    const allow = allowListFor(identity, snap);
    if (!isIsolatedIsland(island) && admitsTranscriber(identity)) allow.push(TRANSCRIBER_IDENTITY);
    out.push({ identity, islandId: island, allow });
  }
  return out;
}

function findClientByIdentity(room: WorldRoom, identity: string): Client | undefined {
  for (const [sessionId, player] of room.state.players) {
    if (player.identity !== identity) continue;
    return room.clients.find((c) => c.sessionId === sessionId);
  }
  return undefined;
}

// Identities without a matching Colyseus client in this room (e.g. an
// npc-* identity, which does not hold a Colyseus session, or a
// same-tenant peer connected to a different WorldRoom shard) are silently
// skipped: there is nothing to push to here. See H4 spec risk #9 — NPC
// audio-zone enforcement beyond the reconciler's forced unsubscribe is a
// documented follow-up.
function sendZonePermissions(room: WorldRoom, payload: ZonePermissionPayload): void {
  const client = findClientByIdentity(room, payload.identity);
  if (!client) return;
  client.send('av_zone_permissions', { islandId: payload.islandId, allow: payload.allow });
}

function flush(orch: PermissionOrchestrator, room: WorldRoom, tracker: MembershipTracker): void {
  const ids = Array.from(orch.pending);
  orch.pending.clear();
  orch.timer = null;
  const snap = snapshot(tracker);
  const admitsTranscriber = transcriberAdmissionFor(room, (identity) => findClientByIdentity(room, identity));
  for (const payload of buildPushPayloads(ids, snap, admitsTranscriber)) sendZonePermissions(room, payload);
}

export function scheduleAllowListPush(
  orch: PermissionOrchestrator,
  room: WorldRoom,
  tracker: MembershipTracker,
  affected: Iterable<string>,
): void {
  for (const identity of affected) orch.pending.add(identity);
  if (orch.pending.size === 0 || orch.timer) return;
  orch.timer = setTimeout(() => flush(orch, room, tracker), BATCH_WINDOW_MS);
}

// Re-push every locally-tracked identity's current allow-list. Used by
// the reconciler to heal a Colyseus message that was lost in transit —
// the client's applied permissions may otherwise silently drift from the
// server's view of island membership.
export function rePushAllForRoom(orch: PermissionOrchestrator, room: WorldRoom, tracker: MembershipTracker): void {
  scheduleAllowListPush(orch, room, tracker, tracker.members.keys());
}

export function disposeOrchestrator(orch: PermissionOrchestrator): void {
  if (orch.timer) {
    clearTimeout(orch.timer);
    orch.timer = null;
  }
  orch.pending.clear();
}
