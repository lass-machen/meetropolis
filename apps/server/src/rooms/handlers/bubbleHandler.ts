import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import type { WorldRoom } from '../WorldRoom.js';
import { canonicalGroupId } from '../utils/bubbleHelpers.js';
import { broadcastBubbleStateToClients, sameScope, senderScope, type SocialScope } from './socialScope.js';

/**
 * Bubble groups are bound to the sender: only seats of the sender's own
 * tenant and map take part in a group, and the server owns the group id. The
 * client may name a group it already knows (join, expand, leave) but it can
 * neither invent an id nor take a group of somebody else apart.
 */
export function handleBubbleUpdate(room: WorldRoom, client: Client, data: { id?: string; members?: string[] }): void {
  const scope = senderScope(room, client);
  if (!scope) {
    logger.debug('[WorldRoom] Dropped bubble_update without a proven scope');
    return;
  }
  const requested = memberIds(data?.members);
  if (requested.length === 0) return;
  for (const sessionId of requested) {
    if (!sameScope(room, sessionId, scope)) {
      logger.debug('[WorldRoom] Dropped bubble_update for a seat outside the sender scope');
      return;
    }
  }
  const groupId = typeof data?.id === 'string' && data.id.length > 0 ? data.id : undefined;
  if (groupId === undefined) {
    formOwnGroup(room, scope, requested);
    return;
  }
  updateExistingGroup(room, scope, groupId, requested);
}

/** The session ids of a message, without duplicates and without empty entries. */
function memberIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) continue;
    if (!ids.includes(entry)) ids.push(entry);
  }
  return ids;
}

/**
 * Is the requested list the way out of a bubble? The sender has to be a
 * member, the list has to hold every seat that is still in the group, and it
 * may not bring in a seat that never belonged to the group.
 */
function isLeaveOf(liveMembers: string[], storedMembers: string[], requested: string[], senderId: string): boolean {
  if (!storedMembers.includes(senderId)) return false;
  const remaining = liveMembers.filter((sessionId) => sessionId !== senderId);
  if (!remaining.every((sessionId) => requested.includes(sessionId))) return false;
  return requested.every((sessionId) => storedMembers.includes(sessionId));
}

/** Does the requested list keep every seat that is still in the group? */
function keepsOldMembers(liveMembers: string[], requested: string[]): boolean {
  return liveMembers.every((sessionId) => requested.includes(sessionId));
}

/** The group the seat belongs to. */
function ownGroupId(room: WorldRoom, sessionId: string): string | undefined {
  for (const [id, members] of Object.entries(room.bubbleGroups)) {
    if (members.includes(sessionId)) return id;
  }
  return undefined;
}

/**
 * A message that names an existing group: joining it, expanding it or
 * leaving it. The group id is the one the server handed out, never a new one.
 */
function updateExistingGroup(room: WorldRoom, scope: SocialScope, groupId: string, requested: string[]): void {
  const existing = room.bubbleGroups[groupId];
  if (!existing) {
    logger.debug('[WorldRoom] Dropped bubble_update for an unknown group');
    return;
  }
  const liveMembers = existing.filter((sessionId) => room.state.players.has(sessionId));
  if (isLeaveOf(liveMembers, existing, requested, scope.sessionId)) {
    setGroupMembers(room, groupId, requested);
    broadcastBubbleStateToClients(room);
    return;
  }
  if (!requested.includes(scope.sessionId) || !keepsOldMembers(liveMembers, requested)) {
    logger.debug('[WorldRoom] Dropped bubble_update that would take a group apart');
    return;
  }
  detachPeers(room, scope, requested, groupId);
  setGroupMembers(room, groupId, requested);
  broadcastBubbleStateToClients(room);
}

/**
 * A message without a group id: the sender forms or enlarges the group of
 * its own scope. The sender has to be part of the list, and the named peers
 * move into that group.
 */
function formOwnGroup(room: WorldRoom, scope: SocialScope, requested: string[]): void {
  if (!requested.includes(scope.sessionId)) {
    logger.debug('[WorldRoom] Dropped bubble_update of a seat outside its own group');
    return;
  }
  const own = ownGroupId(room, scope.sessionId);
  if (requested.length < 2) {
    // The sender names only itself: it leaves its own group.
    if (!own) return;
    delete room.bubbleGroups[own];
    broadcastBubbleStateToClients(room);
    return;
  }
  detachPeers(room, scope, requested, own);
  if (own) delete room.bubbleGroups[own];
  room.bubbleGroups[canonicalGroupId(requested)] = requested;
  broadcastBubbleStateToClients(room);
}

/** Move the named peers out of their own group into the group of the sender. */
function detachPeers(room: WorldRoom, scope: SocialScope, requested: string[], keepGroupId: string | undefined): void {
  for (const sessionId of requested) {
    if (sessionId === scope.sessionId) continue;
    const other = ownGroupId(room, sessionId);
    if (!other || other === keepGroupId) continue;
    const members = room.bubbleGroups[other].filter((member) => member !== sessionId);
    if (members.length < 2) delete room.bubbleGroups[other];
    else room.bubbleGroups[other] = members;
  }
}

/** Write the new member list of a group. A group needs at least two members. */
function setGroupMembers(room: WorldRoom, groupId: string, members: string[]): void {
  if (members.length < 2) {
    delete room.bubbleGroups[groupId];
    return;
  }
  room.bubbleGroups[groupId] = members;
}
