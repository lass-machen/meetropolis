import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useParticipants, type UiParticipant } from './useParticipants';

type HookApi = ReturnType<typeof useParticipants>;

function TestHarness({ deps, out }: { deps: any; out: { current: HookApi | null } }) {
  // The test harness uses untyped deps intentionally: mocked room shape only.
  out.current = useParticipants(deps);
  return <div />;
}

function makeMicPub() {
  return {
    kind: 'audio',
    source: 'microphone',
    muted: false,
    track: {
      kind: 'audio',
      source: 'microphone',
      mediaStreamTrack: { enabled: true, readyState: 'live' },
    },
  };
}

function makeFixture() {
  const localParticipant = {
    sid: 'L1',
    identity: 'lk-local',
    trackPublications: new Map<string, any>([['mic', makeMicPub()]]),
  };
  const remoteParticipant = {
    sid: 'R1',
    identity: 'lk-remote-1',
    trackPublications: new Map<string, any>([['mic', makeMicPub()]]),
  };
  const room: any = {
    localParticipant,
    remoteParticipants: new Map<string, any>([['R1', remoteParticipant]]),
    activeSpeakers: [] as any[],
  };

  const setUiParticipants = vi.fn<(list: UiParticipant[]) => void>();
  const updateSpeakingStates = vi.fn<(ids: Set<string>) => void>();
  const deps: any = {
    avRef: { current: { room } },
    zoneRef: { current: null },
    localPosRef: { current: { id: 'me', x: 0, y: 0 } },
    remotesRef: { current: { c1: { x: 0, y: 0, dnd: false } } },
    colyseusToLivekitMap: { current: { c1: 'lk-remote-1' } },
    identityToNameMap: { current: { 'lk-remote-1': 'Remote One' } },
    volumeRef: { current: null },
    me: { id: 'me', name: 'Me' },
    setUiParticipants,
    getDisplayName: (identity: string) => identity,
    gameBridge: { updateSpeakingStates },
    dndRef: { current: false },
  };

  return { room, localParticipant, remoteParticipant, deps, setUiParticipants, updateSpeakingStates };
}

function lastList(setUiParticipants: Mock<(list: UiParticipant[]) => void>): UiParticipant[] {
  const calls = setUiParticipants.mock.calls;
  return calls[calls.length - 1][0];
}

function lastSpeakingIds(updateSpeakingStates: Mock<(ids: Set<string>) => void>): Set<string> {
  const calls = updateSpeakingStates.mock.calls;
  return calls[calls.length - 1][0];
}

/**
 * Mount/unmount lifecycle for one suite. Call at describe scope; it registers
 * its own before/after hooks and hands back the mounted hook API plus the
 * `mount` helper, so both suites below share one harness instead of two copies.
 */
function useHarness(): { out: { current: HookApi | null }; mount: (deps: unknown) => void } {
  let container: HTMLDivElement;
  let root: Root;
  const out: { current: HookApi | null } = { current: null };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    out.current = null;
  });

  return {
    out,
    mount(deps: unknown): void {
      act(() => {
        root.render(<TestHarness deps={deps} out={out} />);
      });
    },
  };
}

describe('useParticipants speaking indicator', () => {
  const { out, mount } = useHarness();

  it('marks an active remote speaker with live mic as speaking', () => {
    const f = makeFixture();
    f.room.activeSpeakers = [f.remoteParticipant];
    mount(f.deps);

    out.current!.buildParticipantList();

    const remote = lastList(f.setUiParticipants).find((p) => p.displayName === 'Remote One');
    expect(remote).toBeTruthy();
    expect(remote!.isSpeaking).toBe(true);
    expect(lastSpeakingIds(f.updateSpeakingStates).has('c1')).toBe(true);
  });

  it('suppresses the indicator for a remote speaker marked as DND even while the mic is still live', () => {
    const f = makeFixture();
    f.deps.remotesRef.current.c1.dnd = true;
    f.room.activeSpeakers = [f.remoteParticipant];
    mount(f.deps);

    out.current!.buildParticipantList();

    const remote = lastList(f.setUiParticipants).find((p) => p.displayName === 'Remote One');
    expect(remote).toBeTruthy();
    expect(remote!.dnd).toBe(true);
    expect(remote!.isSpeaking).toBe(false);
    expect(lastSpeakingIds(f.updateSpeakingStates).has('c1')).toBe(false);
  });

  it('marks the local participant as speaking when active and not in DND', () => {
    const f = makeFixture();
    f.room.activeSpeakers = [f.localParticipant];
    mount(f.deps);

    out.current!.buildParticipantList();

    const local = lastList(f.setUiParticipants).find((p) => p.sid === 'L1');
    expect(local).toBeTruthy();
    expect(local!.isSpeaking).toBe(true);
    expect(lastSpeakingIds(f.updateSpeakingStates).has('local')).toBe(true);
  });

  it('suppresses the indicator for the local participant while DND is enabled', () => {
    const f = makeFixture();
    f.deps.dndRef.current = true;
    f.room.activeSpeakers = [f.localParticipant];
    mount(f.deps);

    out.current!.buildParticipantList();

    const local = lastList(f.setUiParticipants).find((p) => p.sid === 'L1');
    expect(local).toBeTruthy();
    expect(local!.dnd).toBe(true);
    expect(local!.isSpeaking).toBe(false);
    expect(lastSpeakingIds(f.updateSpeakingStates).has('local')).toBe(false);
  });

  it('does not mark participants as speaking when the mic publication is muted', () => {
    const f = makeFixture();
    const pub = f.remoteParticipant.trackPublications.get('mic');
    pub.muted = true;
    f.room.activeSpeakers = [f.remoteParticipant];
    mount(f.deps);

    out.current!.buildParticipantList();

    const remote = lastList(f.setUiParticipants).find((p) => p.displayName === 'Remote One');
    expect(remote).toBeTruthy();
    expect(remote!.hasMic).toBe(false);
    expect(remote!.isSpeaking).toBe(false);
  });
});

/**
 * A LiveKit room with the local participant plus one remote, and a freely
 * chosen set of Colyseus remotes on top. `colyseusToLivekit` maps a Colyseus
 * session id to its LiveKit identity; an empty value stands for a remote whose
 * mapping has not arrived yet. Every mapped id also gets a position entry,
 * because a LiveKit remote without one is dropped before it can reach a tile
 * (see resolveParticipantPos).
 */
function makeOrphanFixture(colyseusToLivekit: Record<string, string>, identityToName: Record<string, string>) {
  const localParticipant = { sid: 'L1', identity: 'lk-local', trackPublications: new Map<string, any>() };
  const remoteParticipant = { sid: 'R1', identity: 'lk-remote-1', trackPublications: new Map<string, any>() };
  const room: any = {
    localParticipant,
    remoteParticipants: new Map<string, any>([['R1', remoteParticipant]]),
    activeSpeakers: [] as any[],
  };

  const setUiParticipants = vi.fn<(list: UiParticipant[]) => void>();
  const deps: any = {
    avRef: { current: { room } },
    zoneRef: { current: null },
    localPosRef: { current: { id: 'me', x: 0, y: 0 } },
    remotesRef: {
      current: Object.fromEntries(Object.keys(colyseusToLivekit).map((id) => [id, { x: 0, y: 0, dnd: false }])),
    },
    colyseusToLivekitMap: { current: { ...colyseusToLivekit } },
    identityToNameMap: { current: { ...identityToName } },
    volumeRef: { current: null },
    me: { id: 'me', name: 'Me' },
    setUiParticipants,
    getDisplayName: (identity: string) => identity,
    gameBridge: { updateSpeakingStates: vi.fn() },
    dndRef: { current: false },
  };

  return { deps, setUiParticipants };
}

/** The presence-only tiles appendOrphanColyseusRemotes added, in order. */
function orphanTiles(list: UiParticipant[]): UiParticipant[] {
  return list.filter((p) => p.sid.startsWith('col:'));
}

describe('useParticipants: presence tiles for Colyseus remotes without a LiveKit tile', () => {
  const { out, mount } = useHarness();

  it('keeps a tile for a namesake of a participant that is already listed', () => {
    // Two different people called "Max": one has a LiveKit tile (lk-remote-1),
    // the other is still presence-only (lk-remote-2). Deduping by the shared
    // display name would leave the second one without any tile at all.
    const f = makeOrphanFixture(
      { c1: 'lk-remote-1', c2: 'lk-remote-2' },
      { 'lk-remote-1': 'Max', 'lk-remote-2': 'Max' },
    );
    mount(f.deps);

    out.current!.buildParticipantList();

    const list = lastList(f.setUiParticipants);
    // c1 is the same person as the LiveKit tile — no second tile for it.
    expect(orphanTiles(list).map((p) => p.sid)).toEqual(['col:c2']);
    expect(orphanTiles(list)[0].livekitIdentity).toBe('lk-remote-2');
    expect(list.filter((p) => p.displayName === 'Max')).toHaveLength(2);
  });

  it('keeps a tile for each of two presence-only namesakes', () => {
    const f = makeOrphanFixture(
      { c2: 'lk-remote-2', c3: 'lk-remote-3' },
      { 'lk-remote-2': 'Ada', 'lk-remote-3': 'Ada' },
    );
    mount(f.deps);

    out.current!.buildParticipantList();

    expect(orphanTiles(lastList(f.setUiParticipants)).map((p) => p.livekitIdentity)).toEqual([
      'lk-remote-2',
      'lk-remote-3',
    ]);
  });

  it('still suppresses a duplicate among remotes that carry no identity at all', () => {
    // Without a mapping the name is looked up under the Colyseus id, which is
    // the only key such a remote has (see nameKey in appendOrphanColyseusRemotes).
    // Name is all these two can be compared by, so the second one stays hidden.
    const f = makeOrphanFixture({ c4: '', c5: '' }, { c4: 'Ghost', c5: 'Ghost' });
    mount(f.deps);

    out.current!.buildParticipantList();

    expect(orphanTiles(lastList(f.setUiParticipants)).map((p) => p.sid)).toEqual(['col:c4']);
  });
});
