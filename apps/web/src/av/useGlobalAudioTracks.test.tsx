import React from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { useGlobalAudioTracks } from './useGlobalAudioTracks';

function TestHarness({ avRef }: { avRef: React.MutableRefObject<any> }) {
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
    const avRef = { current: { room, dnd: true } } as React.MutableRefObject<any>;

    root.render(<TestHarness avRef={avRef} />);

    // Effect ausführen lassen
    await new Promise((r) => setTimeout(r, 0));

    const audios = Array.from(document.querySelectorAll('audio')) as HTMLAudioElement[];
    expect(audios.length).toBe(1);
    expect(audios[0].muted).toBe(true);
    expect(audios[0].volume).toBe(0);
  });

  it('legt Audiotags ohne DND mit volume=1 an', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const room = makeRoom();
    const avRef = { current: { room, dnd: false } } as React.MutableRefObject<any>;

    root.render(<TestHarness avRef={avRef} />);

    await new Promise((r) => setTimeout(r, 0));

    const audios = Array.from(document.querySelectorAll('audio')) as HTMLAudioElement[];
    expect(audios.length).toBe(1);
    expect(audios[0].muted).toBe(false);
    expect(audios[0].volume).toBeCloseTo(1);
  });
});

















