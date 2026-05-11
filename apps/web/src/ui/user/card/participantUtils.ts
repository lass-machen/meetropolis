import type { Room, LocalParticipant } from 'livekit-client';
import { getApiBaseFromWindow } from '../../../lib/runtimeConfig';
import type { TrackLike } from '../../../types/livekit';
import type { AnyParticipant, LegacyRoom, PartType } from './types';

export const getTrackId = (t: TrackLike | null | undefined): string | null =>
  t?.sid || t?.mediaStreamTrack?.id || (t as { id?: string } | null | undefined)?.id || null;

/**
 * Returns the display name for a participant entry, appending a localised
 * suffix when the entry represents a screen-share. Camera and screen entries
 * share the same `identity`; the `media` discriminator decides the suffix.
 */
export function displayParticipantName(part: PartType, t: (k: string) => string): string {
  if (part.media === 'screen') {
    return `${part.identity} (${t('participant.screenSuffix')})`;
  }
  return part.identity;
}

export function findParticipant(
  room: LegacyRoom,
  baseSid: string,
  part: PartType,
): { p: AnyParticipant | null; baseSid: string } {
  const isLocalNow = room.localParticipant?.sid === baseSid;
  let p: AnyParticipant | null | undefined = isLocalNow
    ? room.localParticipant
    : room.participants?.get?.(baseSid) || room.remoteParticipants?.get?.(baseSid);
  if (p || isLocalNow) return { p: p ?? null, baseSid };
  // Screen-share UI entries share the camera-entry identity; the media
  // discriminator on PartType distinguishes them. Search by identity only.
  const allParticipants: AnyParticipant[] = Array.from(room.remoteParticipants?.values() || []);
  const searchIdentity = part.identity;
  p =
    allParticipants.find((participant) => (participant.name || participant.identity) === searchIdentity) ||
    allParticipants.find((participant) => participant.identity === searchIdentity);
  if (p) return { p, baseSid: p.sid };
  return { p: null, baseSid };
}

export function findScreenParticipant(
  room: LegacyRoom,
  part: PartType,
  currentP: AnyParticipant | null,
): AnyParticipant | null {
  // Screen-share lookup uses the same identity as the camera entry now
  // that no localised suffix is appended.
  const allParticipants: AnyParticipant[] = Array.from(room.remoteParticipants?.values() || []);
  const searchIdentity = part.identity;
  const next =
    allParticipants.find((participant) => (participant.name || participant.identity) === searchIdentity) ||
    allParticipants.find((participant) => participant.identity === searchIdentity);
  return next || currentP;
}

export async function performForceMute(part: PartType, roomGetter: () => Room | undefined) {
  try {
    const label = part.identity || '';
    let targetIdentity = label;
    try {
      const room = roomGetter?.() as LegacyRoom | undefined;
      if (room) {
        const local = room.localParticipant as (LocalParticipant & { name?: string }) | undefined;
        if (local && (local.name === label || local.identity === label)) {
          targetIdentity = local.identity;
        } else {
          const allRemotes: AnyParticipant[] = Array.from(
            room.remoteParticipants?.values?.() || room.participants?.values?.() || [],
          );
          const found =
            allRemotes.find((p) => (p?.name || p?.identity) === label) || allRemotes.find((p) => p?.identity === label);
          if (found?.identity) targetIdentity = found.identity;
        }
      }
    } catch {}
    const base = getApiBaseFromWindow();
    await fetch(`${base}/controls/for/${encodeURIComponent(targetIdentity)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ mic: false }),
    });
  } catch {}
}
