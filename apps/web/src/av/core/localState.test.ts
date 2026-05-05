import { describe, it, expect } from 'vitest';
import { isLocalMicOn, isLocalCamOn, isLocalShareOn } from './localState';

function makeTrack(kind: 'audio'|'video', opts?: { enabled?: boolean; ready?: 'live'|'ended'; source?: any }) {
  const enabled = opts?.enabled ?? true;
  const ready = opts?.ready ?? 'live';
  const source = opts?.source;
  const mediaStreamTrack: any = { enabled, readyState: ready };
  return {
    kind,
    source,
    mediaStreamTrack,
    isEnabled: enabled,
    enabled,
  } as any;
}

function makeRoom(publications: Array<{ kind: 'audio'|'video'; source?: any; enabled?: boolean; ready?: 'live'|'ended'; muted?: boolean }>) {
  const pubs = publications.map((p) => ({
    kind: p.kind,
    source: p.source,
    muted: p.muted ?? false,
    track: makeTrack(p.kind, (() => { const o: { enabled?: boolean; ready?: 'live'|'ended'; source?: any } = {}; if (p.enabled !== undefined) o.enabled = p.enabled; if (p.ready) o.ready = p.ready; if (p.source !== undefined) o.source = p.source; return o; })())
  }));
  return {
    localParticipant: {
      trackPublications: new Map(pubs.map((pub, i) => [String(i), pub])),
    },
  } as any;
}

describe('localState selectors', () => {
  it('detects mic on/off correctly', () => {
    const roomOff = makeRoom([]);
    expect(isLocalMicOn(roomOff)).toBe(false);
    const roomOn = makeRoom([{ kind: 'audio', source: 'microphone', enabled: true, ready: 'live' }]);
    expect(isLocalMicOn(roomOn)).toBe(true);
    const roomEnded = makeRoom([{ kind: 'audio', source: 'microphone', enabled: true, ready: 'ended' }]);
    expect(isLocalMicOn(roomEnded)).toBe(false);
    const roomDisabled = makeRoom([{ kind: 'audio', source: 'microphone', enabled: false, ready: 'live' }]);
    expect(isLocalMicOn(roomDisabled)).toBe(false);
    // Soft-Mute: Publication live + enabled, aber pub.muted=true → Mic gilt als aus.
    const roomMuted = makeRoom([{ kind: 'audio', source: 'microphone', enabled: true, ready: 'live', muted: true }]);
    expect(isLocalMicOn(roomMuted)).toBe(false);
  });

  it('detects camera on/off correctly', () => {
    const roomOff = makeRoom([]);
    expect(isLocalCamOn(roomOff)).toBe(false);
    const roomOn = makeRoom([{ kind: 'video', source: 'camera', enabled: true, ready: 'live' }]);
    expect(isLocalCamOn(roomOn)).toBe(true);
    const roomEnded = makeRoom([{ kind: 'video', source: 'camera', enabled: true, ready: 'ended' }]);
    expect(isLocalCamOn(roomEnded)).toBe(false);
    const roomMuted = makeRoom([{ kind: 'video', source: 'camera', enabled: true, ready: 'live', muted: true }]);
    expect(isLocalCamOn(roomMuted)).toBe(false);
  });

  it('detects screenshare on/off correctly', () => {
    const roomOff = makeRoom([]);
    expect(isLocalShareOn(roomOff)).toBe(false);
    const roomOn = makeRoom([{ kind: 'video', source: 'screen_share', enabled: true, ready: 'live' }]);
    expect(isLocalShareOn(roomOn)).toBe(true);
  });
});


