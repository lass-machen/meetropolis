import { describe, it, expect, vi } from 'vitest';
import { applyDefaultRemoteQualityImpl } from './quality';

function makePub({ kind, src, subscribed }: { kind: 'video' | 'audio'; src?: string; subscribed?: boolean }) {
  const calls: { setVideoQuality: number; setPreferredVideoQuality: number } = { setVideoQuality: 0, setPreferredVideoQuality: 0 };
  const pub: any = {
    kind,
    source: src,
    isSubscribed: !!subscribed,
    track: subscribed ? { kind } : undefined,
    setVideoQuality: () => { calls.setVideoQuality++; },
    setPreferredVideoQuality: () => { calls.setPreferredVideoQuality++; },
  };
  return { pub, calls };
}

describe('applyDefaultRemoteQualityImpl', () => {
  it('setzt keine Videoqualität, wenn nicht subscribed', async () => {
    const { pub, calls } = makePub({ kind: 'video', src: 'camera', subscribed: false });
    const manager: any = {
      current: { remoteParticipants: new Map([['a', { trackPublications: new Map([['v', pub]]) }]]) },
      isSignalOpen: () => true,
      remoteQualityTuningDisabled: false,
      lastApplyDefaultRemoteQualityAt: 0,
      identity: 'me',
      currentName: 'world',
    };
    await applyDefaultRemoteQualityImpl(manager);
    expect(calls.setVideoQuality + calls.setPreferredVideoQuality).toBe(0);
  });

  it('setzt Videoqualität, wenn subscribed', async () => {
    const { pub, calls } = makePub({ kind: 'video', src: 'camera', subscribed: true });
    const manager: any = {
      current: { remoteParticipants: new Map([['a', { trackPublications: new Map([['v', pub]]) }]]) },
      isSignalOpen: () => true,
      remoteQualityTuningDisabled: false,
      lastApplyDefaultRemoteQualityAt: 0,
      identity: 'me',
      currentName: 'world',
    };
    await applyDefaultRemoteQualityImpl(manager);
    expect(calls.setVideoQuality + calls.setPreferredVideoQuality).toBeGreaterThanOrEqual(1);
  });
});


