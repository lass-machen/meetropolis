import { describe, expect, it, vi } from 'vitest';
import { softMuteMicrophone, softUnmuteMicrophone } from './microphonePublishing';

function makeTrack(overrides: Partial<{ mute: () => unknown; unmute: () => unknown; readyState: string }> = {}) {
  const mst: any = { enabled: true, readyState: overrides.readyState ?? 'live' };
  const track: any = {
    mediaStreamTrack: mst,
    mute: overrides.mute ?? vi.fn(() => {}),
    unmute: overrides.unmute ?? vi.fn(() => {}),
  };
  return { track, mst };
}

describe('softMuteMicrophone atomicity', () => {
  it('silences the local capture before muting so audio never keeps flowing', async () => {
    const { track, mst } = makeTrack();
    await softMuteMicrophone(track);
    expect(mst.enabled).toBe(false);
    expect(track.mute).toHaveBeenCalledTimes(1);
  });

  it('leaves the capture silenced even when the RTP mute() rejects', async () => {
    const { track, mst } = makeTrack({
      mute: vi.fn(() => Promise.reject(new Error('mute failed'))),
    });
    await expect(softMuteMicrophone(track)).rejects.toThrow('mute failed');
    // The critical invariant: no audio leak despite the failed RTP-mute.
    expect(mst.enabled).toBe(false);
  });
});

describe('softUnmuteMicrophone', () => {
  it('re-enables a live track and reports success', async () => {
    const { track, mst } = makeTrack();
    mst.enabled = false;
    const ok = await softUnmuteMicrophone(track);
    expect(ok).toBe(true);
    expect(mst.enabled).toBe(true);
    expect(track.unmute).toHaveBeenCalledTimes(1);
  });

  it('returns false without touching an ended track (caller must republish)', async () => {
    const { track } = makeTrack({ readyState: 'ended' });
    const ok = await softUnmuteMicrophone(track);
    expect(ok).toBe(false);
    // An ended track cannot be revived by unmuting; the caller republishes.
    expect(track.unmute).not.toHaveBeenCalled();
  });
});
