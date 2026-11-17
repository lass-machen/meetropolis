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

function makeSubscribableRoom() {
  const seen: Array<(...args: unknown[]) => void> = [];
  const localParticipant = { sid: 'local' };
  const remoteParticipant = {
    sid: 'remote1',
    trackPublications: new Map<string, any>(),
  };
  const room: any = {
    localParticipant,
    remoteParticipants: new Map<string, any>([['remote1', remoteParticipant]]),
    on: (_event: string, handler: (...args: unknown[]) => void) => {
      seen.push(handler);
    },
  };
  return { room, remoteParticipant, seen };
}

function makeRemoteAudioTrack(sid: string, source: string) {
  const attached: HTMLAudioElement[] = [];
  const detached: Array<HTMLMediaElement | undefined> = [];
  const track: any = {
    kind: 'audio',
    sid,
    source,
    mediaStreamTrack: { id: `mst-${sid}`, kind: 'audio' },
    attach: (el?: HTMLMediaElement) => {
      if (el) attached.push(el);
      return el as HTMLAudioElement;
    },
    detach: (el?: HTMLMediaElement) => {
      detached.push(el);
      return [];
    },
  };
  return { track, attached, detached };
}

function remoteAudios(sid: string): HTMLAudioElement[] {
  return Array.from(document.querySelectorAll(`audio[data-av-remote="${sid}"]`));
}

async function awaitHandlers(seen: Array<(...args: unknown[]) => void>) {
  await act(async () => {
    for (let i = 0; i < 200 && seen.length < 2; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
  });
  expect(seen).toHaveLength(2);
}

async function mountHarness(avRef: React.MutableRefObject<any>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<TestHarness avRef={avRef} />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return {
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
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

  it('keeps mic and screen-share audio of one participant on separate elements', async () => {
    const { room, remoteParticipant } = makeSubscribableRoom();
    const mic = makeRemoteAudioTrack('mic-sid', 'microphone');
    const screen = makeRemoteAudioTrack('screen-audio-sid', 'screen_share_audio');
    remoteParticipant.trackPublications.set('mic', { kind: 'audio', source: 'microphone', track: mic.track });
    remoteParticipant.trackPublications.set('screen', {
      kind: 'audio',
      source: 'screen_share_audio',
      track: screen.track,
    });
    const avRef = { current: { room, dndEnabled: false } } as React.MutableRefObject<any>;
    const { cleanup } = await mountHarness(avRef);
    try {
      const nodes = remoteAudios('remote1');
      expect(nodes).toHaveLength(2);
      expect(mic.attached[0]).toBe(nodes[0]);
      expect(screen.attached[0]).toBe(nodes[1]);
      expect(mic.attached[0]).not.toBe(screen.attached[0]);
      for (const node of nodes) {
        expect(node.volume).toBe(0);
      }
    } finally {
      cleanup();
    }
    expect(remoteAudios('remote1')).toHaveLength(0);
  });

  it('screen-share unsubscribe leaves the mic element attached', async () => {
    const { room, remoteParticipant, seen } = makeSubscribableRoom();
    const mic = makeRemoteAudioTrack('mic-sid', 'microphone');
    const screen = makeRemoteAudioTrack('screen-audio-sid', 'screen_share_audio');
    remoteParticipant.trackPublications.set('mic', { kind: 'audio', source: 'microphone', track: mic.track });
    const avRef = { current: { room, dndEnabled: false } } as React.MutableRefObject<any>;
    const { cleanup } = await mountHarness(avRef);
    await awaitHandlers(seen);
    try {
      const [onSubscribed, onUnsubscribed] = seen;
      expect(onSubscribed).toBeTypeOf('function');
      expect(onUnsubscribed).toBeTypeOf('function');
      act(() => {
        onSubscribed(mic.track, { kind: 'audio', source: 'microphone' }, remoteParticipant);
        onSubscribed(screen.track, { kind: 'audio', source: 'screen_share_audio' }, remoteParticipant);
      });
      expect(remoteAudios('remote1')).toHaveLength(2);
      act(() => {
        onUnsubscribed(screen.track, { kind: 'audio', source: 'screen_share_audio' }, remoteParticipant);
      });
      const remaining = remoteAudios('remote1');
      expect(remaining).toHaveLength(1);
      expect(mic.attached).toContain(remaining[0]);
      expect(mic.attached[0].isConnected).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('mic unsubscribe leaves the screen-share audio element attached', async () => {
    const { room, remoteParticipant, seen } = makeSubscribableRoom();
    const mic = makeRemoteAudioTrack('mic-sid', 'microphone');
    const screen = makeRemoteAudioTrack('screen-audio-sid', 'screen_share_audio');
    remoteParticipant.trackPublications.set('screen', {
      kind: 'audio',
      source: 'screen_share_audio',
      track: screen.track,
    });
    const avRef = { current: { room, dndEnabled: false } } as React.MutableRefObject<any>;
    const { cleanup } = await mountHarness(avRef);
    await awaitHandlers(seen);
    try {
      const [onSubscribed, onUnsubscribed] = seen;
      act(() => {
        onSubscribed(mic.track, { kind: 'audio', source: 'microphone' }, remoteParticipant);
        onSubscribed(screen.track, { kind: 'audio', source: 'screen_share_audio' }, remoteParticipant);
      });
      expect(remoteAudios('remote1')).toHaveLength(2);
      act(() => {
        onUnsubscribed(mic.track, { kind: 'audio', source: 'microphone' }, remoteParticipant);
      });
      const remaining = remoteAudios('remote1');
      expect(remaining).toHaveLength(1);
      expect(screen.attached).toContain(remaining[0]);
      expect(screen.attached[0].isConnected).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('re-subscribing the same track creates no duplicate element', async () => {
    const { room, remoteParticipant, seen } = makeSubscribableRoom();
    const mic = makeRemoteAudioTrack('mic-sid', 'microphone');
    remoteParticipant.trackPublications.set('mic', { kind: 'audio', source: 'microphone', track: mic.track });
    const avRef = { current: { room, dndEnabled: false } } as React.MutableRefObject<any>;
    const { cleanup } = await mountHarness(avRef);
    await awaitHandlers(seen);
    try {
      const [onSubscribed] = seen;
      act(() => {
        onSubscribed(mic.track, { kind: 'audio', source: 'microphone' }, remoteParticipant);
        onSubscribed(mic.track, { kind: 'audio', source: 'microphone' }, remoteParticipant);
      });
      expect(remoteAudios('remote1')).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it('detaches the unsubscribed track from its element and keeps the other track', async () => {
    const { room, remoteParticipant, seen } = makeSubscribableRoom();
    const mic = makeRemoteAudioTrack('mic-sid', 'microphone');
    const screen = makeRemoteAudioTrack('screen-audio-sid', 'screen_share_audio');
    const avRef = { current: { room, dndEnabled: false } } as React.MutableRefObject<any>;
    const { cleanup } = await mountHarness(avRef);
    await awaitHandlers(seen);
    let cleaned = false;
    const cleanupOnce = () => {
      if (!cleaned) {
        cleaned = true;
        cleanup();
      }
    };
    try {
      const [onSubscribed, onUnsubscribed] = seen;
      act(() => {
        onSubscribed(mic.track, { kind: 'audio', source: 'microphone' }, remoteParticipant);
        onSubscribed(screen.track, { kind: 'audio', source: 'screen_share_audio' }, remoteParticipant);
      });
      act(() => {
        onUnsubscribed(screen.track, { kind: 'audio', source: 'screen_share_audio' }, remoteParticipant);
      });
      expect(screen.detached).toEqual([screen.attached[0]]);
      expect(mic.detached).toEqual([]);
      expect(mic.attached[0].isConnected).toBe(true);
    } finally {
      cleanupOnce();
    }
  });

  it('detaches every track from its element on unmount', async () => {
    const { room, remoteParticipant, seen } = makeSubscribableRoom();
    const mic = makeRemoteAudioTrack('mic-sid', 'microphone');
    const screen = makeRemoteAudioTrack('screen-audio-sid', 'screen_share_audio');
    const avRef = { current: { room, dndEnabled: false } } as React.MutableRefObject<any>;
    const { cleanup } = await mountHarness(avRef);
    await awaitHandlers(seen);
    let cleaned = false;
    const cleanupOnce = () => {
      if (!cleaned) {
        cleaned = true;
        cleanup();
      }
    };
    try {
      const [onSubscribed] = seen;
      act(() => {
        onSubscribed(mic.track, { kind: 'audio', source: 'microphone' }, remoteParticipant);
        onSubscribed(screen.track, { kind: 'audio', source: 'screen_share_audio' }, remoteParticipant);
      });
      expect(remoteAudios('remote1')).toHaveLength(2);
      cleanupOnce();
      expect(mic.detached).toEqual([mic.attached[0]]);
      expect(screen.detached).toEqual([screen.attached[0]]);
      expect(remoteAudios('remote1')).toHaveLength(0);
    } finally {
      cleanupOnce();
    }
  });
});
