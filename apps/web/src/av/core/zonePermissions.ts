/**
 * Pure helpers for the H4 audio-zone privacy SFU-hard boundary.
 *
 * LiveKit's `localParticipant.setTrackSubscriptionPermissions` can only
 * be called by the publisher itself: it restricts, at the SFU, who is
 * allowed to subscribe to this participant's own published tracks. It is
 * independent of any subscriber's token-level `canSubscribe` grant and
 * does not require the server's LiveKit admin API - see
 * apps/server/src/rooms/audioZones/reconciler.ts's module doc for the
 * full picture (this is the primary boundary; the server reconciler is a
 * secondary defense-in-depth correction loop).
 */

import type { ParticipantTrackPermission } from 'livekit-client';

// `allParticipantsAllowed: false` plus this list means "only these
// identities may subscribe to my tracks". An empty list is the
// deny-all baseline applied immediately on connect, before the first
// real `av_zone_permissions` push arrives.
export function buildTrackPermissions(allow: readonly string[]): ParticipantTrackPermission[] {
  // `allowAll: true` is required: a permission entry that only names the
  // participant grants NO tracks (LiveKit resolves it to HasPermission=false),
  // so co-island peers would be listed but still inaudible. Grant all of the
  // allowed participant's tracks (audio, camera, screenshare) — zone scope is
  // enforced by WHO is on the list, not by which of their tracks.
  return allow.map((participantIdentity) => ({ participantIdentity, allowAll: true }));
}
