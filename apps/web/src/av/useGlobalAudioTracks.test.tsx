import React from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useGlobalAudioTracks } from './useGlobalAudioTracks';

function TestHarness({ avRef }: { avRef: React.MutableRefObject<any> }) {
  // The test harness uses an untyped avRef intentionally: mocked room shape only.
  useGlobalAudioTracks({ avRef });
  return <div />;
}

function makeRoom({ withAudio = true }: { withAudio?: boolean } = {}) {
  const localParticipant = { sid: 'local' };
  const track = withAudio ? { kind: 'audio', attach: (_el: HTMLAudioElement) => {} } : null;
  const pub = track ? { kind: 'audio', track } : null;
  const remoteParticipant = {
    sid: 'remote1',
    trackPublications: new Map<string, any>(pub ? [['audio', pub]] : []),
  };
  const room: any = {
    localParticipant,
    remoteParticipants: new Map<string, any>([['remote1', remoteParticipant]]),
  };
  return room;
}

describe('useGlobalAudioTracks', () => {
  it('legt Audiotags bei DND stumm an (muted & volume=0)', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const room = makeRoom();
    const avRef = { current: { room, dndEnabled: true } } as React.MutableRefObject<any>;

    act(() => {
      root.render(<TestHarness avRef={avRef} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const audio: HTMLAudioElement | null = document.querySelector('audio[data-av-remote="remote1"]');
    expect(audio).toBeTruthy();
    expect(audio!.muted).toBe(true);
    expect(audio!.volume).toBe(0);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('legt Audiotags ohne DND mit volume=1 an', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const room = makeRoom();
    const avRef = { current: { room, dndEnabled: false } } as React.MutableRefObject<any>;

    act(() => {
      root.render(<TestHarness avRef={avRef} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const audio: HTMLAudioElement | null = document.querySelector('audio[data-av-remote="remote1"]');
    expect(audio).toBeTruthy();
    expect(audio!.muted).toBe(false);
    expect(audio!.volume).toBeCloseTo(1);

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
