import React from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useGlobalAudioTracks } from './useGlobalAudioTracks';
import { emitAudioTracksChanged } from '../lib/avEvents';

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
  it('creates audio tags muted under DND (muted & volume=0)', async () => {
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

  it('creates audio tags without DND unmuted but silent (volume authority raises)', async () => {
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
    // Zone isolation: elements must start silent; only the volume authority
    // (VolumeManager) may raise playback volume.
    expect(audio!.volume).toBe(0);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('does not overwrite authority-set volume on audio-tracks-changed', async () => {
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

    // Simulate the volume authority having muted this participant (foreign zone).
    audio!.volume = 0;
    audio!.muted = false;
    act(() => {
      emitAudioTracksChanged();
    });
    expect(audio!.volume).toBe(0);

    // And a partially attenuated participant must keep the authority value too.
    audio!.volume = 0.25;
    act(() => {
      emitAudioTracksChanged();
    });
    expect(audio!.volume).toBeCloseTo(0.25);
    expect(audio!.muted).toBe(false);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('clears a stale muted flag on audio-tracks-changed when DND is off', async () => {
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

    // DND exit: restoreAllRemote emits the change event with dnd off.
    avRef.current.dndEnabled = false;
    act(() => {
      emitAudioTracksChanged();
    });
    expect(audio!.muted).toBe(false);
    // Volume stays under authority control (still silent until recomputed).
    expect(audio!.volume).toBe(0);

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
