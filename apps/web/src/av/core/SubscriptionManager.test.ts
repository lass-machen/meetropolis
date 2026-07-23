import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Room } from 'livekit-client';
import { SubscriptionManager, type SubscriptionManagerConfig } from './SubscriptionManager';
import { emitBubbleMembers, onAudioTracksChanged } from '../../lib/avEvents';

interface FakePub {
  kind: 'audio' | 'video';
  source?: string;
  isSubscribed: boolean;
  track: { setVolume: ReturnType<typeof vi.fn> } | null;
  setSubscribed: ReturnType<typeof vi.fn>;
}

interface FakeParticipant {
  identity: string;
  trackPublications: Map<string, FakePub>;
}

function makeParticipant(identity: string, kinds: Array<'audio' | 'video'>): FakeParticipant {
  const pubs = new Map<string, FakePub>();
  for (const kind of kinds) {
    pubs.set(`${identity}:${kind}`, {
      kind,
      isSubscribed: false,
      track: { setVolume: vi.fn() },
      setSubscribed: vi.fn(),
    });
  }
  return { identity, trackPublications: pubs };
}

function makeRoom(participants: FakeParticipant[]): Room {
  const map = new Map<string, FakeParticipant>(participants.map((p) => [p.identity, p]));
  return { remoteParticipants: map } as unknown as Room;
}

function makeManager(room: Room, config?: Partial<SubscriptionManagerConfig>) {
  return new SubscriptionManager(
    {
      maxVideoSubscriptions: 1,
      videoRetentionMs: 0,
      fallbackIntervalMs: 60_000,
      maxAudioSubscriptions: 6,
      ...config,
    },
    {
      getRoom: () => room,
      isSignalOpen: () => true,
      isDND: () => false,
    },
  );
}

function allSetVolumeCalls(participants: FakeParticipant[]): number {
  let calls = 0;
  for (const p of participants) {
    for (const pub of p.trackPublications.values()) {
      calls += pub.track?.setVolume.mock.calls.length ?? 0;
    }
  }
  return calls;
}

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    manager?.dispose();
    manager = null;
    vi.useRealTimers();
  });

  it('setParticipantVolume writes clamped values only to the matching identity', () => {
    const alice = makeParticipant('user-a', ['audio']);
    const bob = makeParticipant('user-b', ['audio']);
    manager = makeManager(makeRoom([alice, bob]));

    manager.setParticipantVolume('user-a', 5);
    manager.setParticipantVolume('user-a', -1);
    manager.setParticipantVolume('user-a', 0.4);

    const aliceSetVolume = alice.trackPublications.get('user-a:audio')!.track!.setVolume;
    expect(aliceSetVolume.mock.calls.map((c) => c[0])).toEqual([1, 0, 0.4]);
    expect(allSetVolumeCalls([bob])).toBe(0);
  });

  it('bubble updates never write volumes (volume authority owns them)', () => {
    const alice = makeParticipant('user-a', ['audio']);
    const bob = makeParticipant('user-b', ['audio']);
    manager = makeManager(makeRoom([alice, bob]));
    manager.start();

    emitBubbleMembers(['user-a']);
    vi.advanceTimersByTime(500);

    expect(allSetVolumeCalls([alice, bob])).toBe(0);
  });

  it('bubble updates carry LiveKit identities and prioritize their video subscription', () => {
    const alice = makeParticipant('user-a', ['audio', 'video']);
    const bob = makeParticipant('user-b', ['audio', 'video']);
    const carol = makeParticipant('user-c', ['audio', 'video']);
    manager = makeManager(makeRoom([alice, bob, carol]));
    manager.start();

    emitBubbleMembers(['user-a']);
    vi.advanceTimersByTime(500);

    expect(alice.trackPublications.get('user-a:video')!.setSubscribed).toHaveBeenCalledWith(true);
    expect(bob.trackPublications.get('user-b:video')!.setSubscribed).not.toHaveBeenCalledWith(true);
    expect(carol.trackPublications.get('user-c:video')!.setSubscribed).not.toHaveBeenCalledWith(true);
  });

  it('muteAllRemote sets all remote audio tracks to zero (fail-closed DND)', () => {
    const alice = makeParticipant('user-a', ['audio']);
    const bob = makeParticipant('user-b', ['audio']);
    manager = makeManager(makeRoom([alice, bob]));

    manager.muteAllRemote();

    expect(alice.trackPublications.get('user-a:audio')!.track!.setVolume).toHaveBeenCalledWith(0);
    expect(bob.trackPublications.get('user-b:audio')!.track!.setVolume).toHaveBeenCalledWith(0);
  });

  it('restoreAllRemote emits audio-tracks-changed without writing volumes', () => {
    const alice = makeParticipant('user-a', ['audio']);
    manager = makeManager(makeRoom([alice]));

    const changed = vi.fn();
    const off = onAudioTracksChanged(changed);
    try {
      manager.restoreAllRemote();
    } finally {
      off();
    }

    expect(changed).toHaveBeenCalledTimes(1);
    expect(allSetVolumeCalls([alice])).toBe(0);
  });
});
