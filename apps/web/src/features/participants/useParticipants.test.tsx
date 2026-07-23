import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useParticipants, type UIParticipant } from './useParticipants';

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

  const setUiParticipants = vi.fn<(list: UIParticipant[]) => void>();
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

function lastList(setUiParticipants: Mock<(list: UIParticipant[]) => void>): UIParticipant[] {
  const calls = setUiParticipants.mock.calls;
  return calls[calls.length - 1][0];
}

function lastSpeakingIds(updateSpeakingStates: Mock<(ids: Set<string>) => void>): Set<string> {
  const calls = updateSpeakingStates.mock.calls;
  return calls[calls.length - 1][0];
}

describe('useParticipants speaking indicator', () => {
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

  function mount(deps: unknown): void {
    act(() => {
      root.render(<TestHarness deps={deps} out={out} />);
    });
  }

  it('marks an active remote speaker with live mic as speaking', () => {
    const f = makeFixture();
    f.room.activeSpeakers = [f.remoteParticipant];
    mount(f.deps);

    out.current!.buildParticipantList();

    const remote = lastList(f.setUiParticipants).find((p) => p.identity === 'Remote One');
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

    const remote = lastList(f.setUiParticipants).find((p) => p.identity === 'Remote One');
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

    const remote = lastList(f.setUiParticipants).find((p) => p.identity === 'Remote One');
    expect(remote).toBeTruthy();
    expect(remote!.hasMic).toBe(false);
    expect(remote!.isSpeaking).toBe(false);
  });
});
