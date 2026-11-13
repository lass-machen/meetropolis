import { describe, expect, it } from 'vitest';

import { bindingKey, selectInbound, selectOutbound } from '../../../e2e/av/mediaFlow';
import type { MediaFlowBinding, MediaFlowSnapshot } from '../../../e2e/av/mediaFlow';

// Plain-data vectors for the two-snapshot key selection (H1). No browser,
// LiveKit or Playwright doubles: only the pure selection exports above run
// against hand-built snapshots. Every expected key comes from bindingKey
// applied to the reference row, never from a copied implementation.

function row(overrides: Partial<MediaFlowBinding>): MediaFlowBinding {
  return {
    peer: 'pc-0',
    direction: 'outbound',
    kind: 'video',
    trackId: 'track-out',
    readyState: 'live',
    mid: '0',
    statsId: 'outbound-rtp-q',
    ssrc: 2,
    bytesSent: null,
    bytesReceived: null,
    trackIdentifier: null,
    remoteSid: null,
    statsError: null,
    ...overrides,
  };
}

function peers(groups: Array<{ ref: string; bindings: MediaFlowBinding[] }>): MediaFlowSnapshot {
  return {
    instrumented: true,
    pcCount: groups.length,
    peers: groups.map((group) => ({
      ref: group.ref,
      iceConnectionState: 'connected',
      connectionState: 'connected',
      selectedPair: null,
      pairStatsError: null,
      iceCandidateErrors: [],
      bindings: group.bindings,
    })),
  };
}

function single(ref: string, bindings: MediaFlowBinding[]): MediaFlowSnapshot {
  return peers([{ ref, bindings }]);
}

describe('selectOutbound two-snapshot growth', () => {
  const track = { peer: 'pc-0', trackId: 'track-out' };

  it('prefers a small growing layer over a paused large layer', () => {
    const bigBefore = row({ statsId: 'outbound-rtp-f', ssrc: 1, bytesSent: 1000000 });
    const smallBefore = row({ statsId: 'outbound-rtp-q', ssrc: 2, bytesSent: 100 });
    const bigAfter = row({ statsId: 'outbound-rtp-f', ssrc: 1, bytesSent: 1000000 });
    const smallAfter = row({ statsId: 'outbound-rtp-q', ssrc: 2, bytesSent: 260 });
    const key = selectOutbound(
      single('pc-0', [bigBefore, smallBefore]),
      single('pc-0', [bigAfter, smallAfter]),
      'video',
      track,
    );
    expect(key).toBe(bindingKey(smallAfter));
  });

  it('keeps the own growing row when a foreign row grows faster', () => {
    const ownBefore = row({ bytesSent: 300 });
    const ownAfter = row({ bytesSent: 360 });
    const foreignBefore = row({ peer: 'pc-9', trackId: 'track-foreign', statsId: 'outbound-x', ssrc: 7, bytesSent: 5 });
    const foreignAfter = row({
      peer: 'pc-9',
      trackId: 'track-foreign',
      statsId: 'outbound-x',
      ssrc: 7,
      bytesSent: 5000,
    });
    const before = peers([
      { ref: 'pc-0', bindings: [ownBefore] },
      { ref: 'pc-9', bindings: [foreignBefore] },
    ]);
    const after = peers([
      { ref: 'pc-0', bindings: [ownAfter] },
      { ref: 'pc-9', bindings: [foreignAfter] },
    ]);
    expect(selectOutbound(before, after, 'video', track)).toBe(bindingKey(ownAfter));
  });

  it('rejects unchanged byte counters', () => {
    const before = row({ bytesSent: 500 });
    const after = row({ bytesSent: 500 });
    expect(() => selectOutbound(single('pc-0', [before]), single('pc-0', [after]), 'video', track)).toThrow(
      /media-flow-no-outbound-video/,
    );
  });

  it('rejects a new row without a matching previous row', () => {
    const fresh = row({ statsId: 'outbound-rtp-q', ssrc: 9, bytesSent: 40 });
    expect(() => selectOutbound(single('pc-0', []), single('pc-0', [fresh]), 'video', track)).toThrow(
      /media-flow-no-outbound-video/,
    );
  });

  it('rejects a counter reset as growth', () => {
    const before = row({ bytesSent: 900 });
    const after = row({ bytesSent: 12 });
    expect(() => selectOutbound(single('pc-0', [before]), single('pc-0', [after]), 'video', track)).toThrow(
      /media-flow-no-outbound-video/,
    );
  });

  it('rejects rows without native stats identity', () => {
    const before = row({ statsId: null, ssrc: null, bytesSent: 10 });
    const after = row({ statsId: null, ssrc: null, bytesSent: 30 });
    expect(() => selectOutbound(single('pc-0', [before]), single('pc-0', [after]), 'video', track)).toThrow(
      /native stats identity missing/,
    );
  });

  it('rejects a missing counter as growth', () => {
    const before = row({ bytesSent: 10 });
    const after = row({ bytesSent: null });
    expect(() => selectOutbound(single('pc-0', [before]), single('pc-0', [after]), 'video', track)).toThrow(
      /media-flow-no-outbound-video/,
    );
  });

  it('ignores growth on foreign peer rows', () => {
    const ownBefore = row({ bytesSent: 300 });
    const ownAfter = row({ bytesSent: 300 });
    const foreignBefore = row({ peer: 'pc-9', trackId: 'track-foreign', statsId: 'outbound-x', ssrc: 7, bytesSent: 5 });
    const foreignAfter = row({
      peer: 'pc-9',
      trackId: 'track-foreign',
      statsId: 'outbound-x',
      ssrc: 7,
      bytesSent: 5000,
    });
    const before = peers([
      { ref: 'pc-0', bindings: [ownBefore] },
      { ref: 'pc-9', bindings: [foreignBefore] },
    ]);
    const after = peers([
      { ref: 'pc-0', bindings: [ownAfter] },
      { ref: 'pc-9', bindings: [foreignAfter] },
    ]);
    expect(() => selectOutbound(before, after, 'video', track)).toThrow(/media-flow-no-outbound-video/);
  });
});

describe('selectInbound two-snapshot growth', () => {
  const track = { peer: 'pc-1', trackId: 'track-in' };
  const sid = 'PAremote1';
  const inbound = (overrides: Partial<MediaFlowBinding>): MediaFlowBinding =>
    row({
      peer: 'pc-1',
      direction: 'inbound',
      trackId: 'track-in',
      trackIdentifier: 'track-in',
      remoteSid: sid,
      bytesSent: null,
      ...overrides,
    });

  it('prefers a small growing layer over a paused large layer', () => {
    const bigBefore = inbound({ statsId: 'inbound-rtp-f', ssrc: 11, bytesReceived: 2000000 });
    const smallBefore = inbound({ statsId: 'inbound-rtp-q', ssrc: 12, bytesReceived: 80 });
    const bigAfter = inbound({ statsId: 'inbound-rtp-f', ssrc: 11, bytesReceived: 2000000 });
    const smallAfter = inbound({ statsId: 'inbound-rtp-q', ssrc: 12, bytesReceived: 190 });
    const key = selectInbound(
      single('pc-1', [bigBefore, smallBefore]),
      single('pc-1', [bigAfter, smallAfter]),
      'video',
      track,
      sid,
    );
    expect(key).toBe(bindingKey(smallAfter));
  });

  it('ignores growth on rows with an unexpected remote sid', () => {
    const ownBefore = inbound({ bytesReceived: 400 });
    const ownAfter = inbound({ bytesReceived: 400 });
    const foreignBefore = inbound({ remoteSid: 'PAstranger', statsId: 'inbound-x', ssrc: 21, bytesReceived: 7 });
    const foreignAfter = inbound({ remoteSid: 'PAstranger', statsId: 'inbound-x', ssrc: 21, bytesReceived: 700 });
    expect(() =>
      selectInbound(
        single('pc-1', [ownBefore, foreignBefore]),
        single('pc-1', [ownAfter, foreignAfter]),
        'video',
        track,
        sid,
      ),
    ).toThrow(/media-flow-no-inbound-video/);
  });

  it('rejects unchanged byte counters', () => {
    const before = inbound({ bytesReceived: 500 });
    const after = inbound({ bytesReceived: 500 });
    expect(() => selectInbound(single('pc-1', [before]), single('pc-1', [after]), 'video', track, sid)).toThrow(
      /media-flow-no-inbound-video/,
    );
  });

  it('rejects a new row without a matching previous row', () => {
    const fresh = inbound({ statsId: 'inbound-rtp-q', ssrc: 29, bytesReceived: 60 });
    expect(() => selectInbound(single('pc-1', []), single('pc-1', [fresh]), 'video', track, sid)).toThrow(
      /media-flow-no-inbound-video/,
    );
  });

  it('rejects a track identifier that disagrees with the receiver track', () => {
    const before = inbound({ bytesReceived: 50 });
    const after = inbound({ bytesReceived: 120, trackIdentifier: 'other-track' });
    expect(() => selectInbound(single('pc-1', [before]), single('pc-1', [after]), 'video', track, sid)).toThrow(
      /media-flow-trackidentifier-mismatch/,
    );
  });
});
