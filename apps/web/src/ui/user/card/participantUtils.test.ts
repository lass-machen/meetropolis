import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Room } from 'livekit-client';
import { displayParticipantName, findParticipant, performForceMute } from './participantUtils';
import type { AnyParticipant, UiParticipant } from './types';

/**
 * Minimal stand-in for a LiveKit participant. Only the fields the resolver
 * touches are modelled; `trackPublications` exists because callers guard on it.
 * The single cast keeps every call site free of casts (LIBRARY_BOUNDARIES.md,
 * pattern 1: narrow the library type once at the boundary).
 */
type FakeParticipant = {
  sid: string;
  identity: string;
  name?: string;
  trackPublications: Map<string, unknown>;
};

function participant(sid: string, identity: string, name?: string): AnyParticipant {
  const fake: FakeParticipant = {
    sid,
    identity,
    ...(name === undefined ? {} : { name }),
    trackPublications: new Map(),
  };
  return fake as unknown as AnyParticipant;
}

/**
 * Room double that mirrors the real SDK: `remoteParticipants` is a
 * `Map<identity, RemoteParticipant>`, NOT a map keyed by participant SID, and
 * there is no legacy `participants` map at all (livekit-client 2.x removed it).
 */
function makeRoom(opts: { local?: AnyParticipant; remotes?: AnyParticipant[] }): Room {
  const remoteParticipants = new Map<string, AnyParticipant>();
  for (const r of opts.remotes ?? []) remoteParticipants.set(r.identity, r);
  return {
    localParticipant: opts.local,
    remoteParticipants,
  } as unknown as Room;
}

function tile(
  over: Partial<UiParticipant> & Pick<UiParticipant, 'sid' | 'livekitIdentity' | 'displayName'>,
): UiParticipant {
  return {
    hasVideo: true,
    hasMic: true,
    isSpeaking: false,
    media: 'camera',
    ...over,
  };
}

describe('room double contract', () => {
  it('keys remoteParticipants by identity, so a SID lookup misses', () => {
    const remote = participant('PA_sid', 'user-42');
    const room = makeRoom({ remotes: [remote] });
    // This is exactly why the previous SID-based `remoteParticipants.get(sid)`
    // could never hit for any remote participant.
    expect(room.remoteParticipants.get('PA_sid')).toBeUndefined();
    expect(room.remoteParticipants.get('user-42')).toBe(remote);
  });
});

describe('findParticipant', () => {
  it('resolves a remote participant by LiveKit identity even when the LiveKit name is empty', () => {
    // The iOS publisher case: joins with name="", so the web client's display
    // name falls back to a truncated user id that matches no LiveKit field.
    const ios = participant('PA_ios', 'a1b2c3d4e5f6a7b8c9d0', '');
    const room = makeRoom({ remotes: [ios] });
    const part = tile({ sid: 'PA_ios', livekitIdentity: 'a1b2c3d4e5f6a7b8c9d0', displayName: 'User a1b2c3' });

    const found = findParticipant(room, 'PA_ios', part);

    expect(found.p).toBe(ios);
    expect(found.isLocal).toBe(false);
    expect(found.baseSid).toBe('PA_ios');
  });

  it('does not confuse two participants that share a display name', () => {
    // N1: two guests without a profile name resolve to the same label. A
    // name-based lookup returns the first match for both tiles and puts one
    // participant's camera under the other participant's name.
    const first = participant('PA_first', 'guest-1', 'Gast');
    const second = participant('PA_second', 'guest-2', 'Gast');
    const room = makeRoom({ remotes: [first, second] });

    const firstTile = tile({ sid: 'PA_first', livekitIdentity: 'guest-1', displayName: 'Gast' });
    const secondTile = tile({ sid: 'PA_second', livekitIdentity: 'guest-2', displayName: 'Gast' });

    expect(findParticipant(room, 'PA_first', firstTile).p).toBe(first);
    expect(findParticipant(room, 'PA_second', secondTile).p).toBe(second);
  });

  it('falls back to a SID scan when the tile carries no identity', () => {
    const remote = participant('PA_sid', 'user-42', 'Someone');
    const room = makeRoom({ remotes: [remote] });
    const part = tile({ sid: 'PA_sid', livekitIdentity: '', displayName: 'Someone' });

    expect(findParticipant(room, 'PA_sid', part).p).toBe(remote);
  });

  it('returns null when neither identity nor SID matches, even on a display-name hit', () => {
    const remote = participant('PA_sid', 'user-42', 'Gast');
    const room = makeRoom({ remotes: [remote] });
    // A stale tile for someone who already left, sharing the label of someone
    // who is still here. Resolving it would attach a stranger's camera.
    const part = tile({ sid: 'PA_gone', livekitIdentity: 'user-99', displayName: 'Gast' });

    const found = findParticipant(room, 'PA_gone', part);

    expect(found.p).toBeNull();
    expect(found.isLocal).toBe(false);
    expect(found.baseSid).toBe('PA_gone');
  });

  it('identifies the local tile by identity and reports the local participant current SID', () => {
    // A reconnect mints a new SID while the identity is unchanged; the tile
    // still carries the SID it was built with.
    const local = participant('L_new', 'me');
    const room = makeRoom({ local, remotes: [participant('PA_other', 'other', 'Me')] });
    const part = tile({ sid: 'L_old', livekitIdentity: 'me', displayName: 'Me' });

    const found = findParticipant(room, 'L_old', part);

    expect(found.isLocal).toBe(true);
    expect(found.p).toBe(local);
    expect(found.baseSid).toBe('L_new');
  });

  it('does not treat a remote tile as local just because it shares the local display name', () => {
    const local = participant('L1', 'me', 'Gast');
    const remote = participant('PA_r', 'guest-1', 'Gast');
    const room = makeRoom({ local, remotes: [remote] });
    const part = tile({ sid: 'PA_r', livekitIdentity: 'guest-1', displayName: 'Gast' });

    const found = findParticipant(room, 'PA_r', part);

    expect(found.isLocal).toBe(false);
    expect(found.p).toBe(remote);
  });
});

describe('findParticipant: screen tiles', () => {
  // A screen tile carries the publisher's identity, exactly like its camera
  // tile; `media` plus the ':screen' SID suffix keep the two apart. The caller
  // strips the suffix before the lookup (see useVideoTrackAttachment).
  it('resolves the screen tile to its own publisher when display names collide', () => {
    const first = participant('PA_first', 'guest-1', 'Gast');
    const second = participant('PA_second', 'guest-2', 'Gast');
    const room = makeRoom({ remotes: [first, second] });
    const screenTile = tile({
      sid: 'PA_second:screen',
      livekitIdentity: 'guest-2',
      displayName: 'Gast',
      media: 'screen',
    });

    expect(findParticipant(room, 'PA_second', screenTile).p).toBe(second);
  });

  it('returns null when the publisher is not in the room', () => {
    const room = makeRoom({ remotes: [] });
    const screenTile = tile({
      sid: 'PA_second:screen',
      livekitIdentity: 'guest-2',
      displayName: 'Gast',
      media: 'screen',
    });

    expect(findParticipant(room, 'PA_second', screenTile).p).toBeNull();
  });
});

describe('displayParticipantName', () => {
  const t = (k: string) => (k === 'participant.screenSuffix' ? 'Bildschirm' : k);

  it('renders the label for a camera tile', () => {
    expect(displayParticipantName(tile({ sid: 'a', livekitIdentity: 'i', displayName: 'Gast' }), t)).toBe('Gast');
  });

  it('appends the localised suffix for a screen tile', () => {
    const screenTile = tile({ sid: 'a:screen', livekitIdentity: 'i', displayName: 'Gast', media: 'screen' });
    expect(displayParticipantName(screenTile, t)).toBe('Gast (Bildschirm)');
  });
});

describe('performForceMute', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('addresses the target by LiveKit identity, not by the display name', async () => {
    const first = participant('PA_first', 'guest-1', 'Gast');
    const second = participant('PA_second', 'guest-2', 'Gast');
    const room = makeRoom({ local: participant('L1', 'me'), remotes: [first, second] });
    const part = tile({ sid: 'PA_second', livekitIdentity: 'guest-2', displayName: 'Gast' });

    await performForceMute(part, room);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/controls/for/guest-2');
    expect(url).not.toContain('Gast');
  });

  it('sends nothing for a tile with no LiveKit identity', async () => {
    const room = makeRoom({ local: participant('L1', 'me'), remotes: [] });
    const part = tile({ sid: 'col:abc', livekitIdentity: '', displayName: 'Gast' });

    await performForceMute(part, room);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing for a presence tile whose identity is not a participant of this room', async () => {
    // A `col:` tile does carry a livekitIdentity as soon as the
    // Colyseus-to-LiveKit mapping knows one, so the identity string alone is
    // no evidence of a publisher here. Muting on it would reach somebody
    // outside the caller's audio zone.
    const room = makeRoom({ local: participant('L1', 'me'), remotes: [participant('PA_here', 'guest-1', 'Gast')] });
    const part = tile({ sid: 'col:abc', livekitIdentity: 'guest-2', displayName: 'Gast' });

    await performForceMute(part, room);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing for the local tile', async () => {
    const local = participant('L1', 'me', 'Ich');
    const room = makeRoom({ local, remotes: [] });
    const part = tile({ sid: 'L1', livekitIdentity: 'me', displayName: 'Ich' });

    await performForceMute(part, room);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing when there is no room at all', async () => {
    const part = tile({ sid: 'PA_second', livekitIdentity: 'guest-2', displayName: 'Gast' });

    await performForceMute(part, undefined);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('addresses the identity the room reports, not the one the tile was built with', async () => {
    // The tile can be stale after a reconnect; the resolver is the authority.
    const remote = participant('PA_r', 'guest-2', 'Gast');
    const room = makeRoom({ local: participant('L1', 'me'), remotes: [remote] });
    const part = tile({ sid: 'PA_r', livekitIdentity: '', displayName: 'Gast' });

    await performForceMute(part, room);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/controls/for/guest-2');
  });
});
