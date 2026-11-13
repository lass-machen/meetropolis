import type { Page, TestInfo } from '@playwright/test';

/**
 * Passive media-flow observation for the media proof draft.
 *
 * The init script wraps the native RTCPeerConnection constructor (Proxy
 * plus Reflect.construct) before the app creates its peer connections.
 * Constructor arguments, ICE servers, iceTransportPolicy and constraints
 * pass through untouched; no track is replaced or injected.
 *
 * Proof comes only from native per-sender/per-receiver getStats() rows
 * tied to the actual track handle, keyed by peerRef + direction +
 * trackId + stats id/ssrc. Kind-wide sums are diagnostics, never proof.
 * Stream id parsing mirrors livekit-client 2.22.3
 * (src/room/utils.ts unpackStreamId splits on '|', src/room/Room.ts
 * onTrack reads participantSid from parts[0]).
 *
 * No raw SDP, ICE URLs, IPs, keys, JWTs or cookies are ever recorded.
 */

export type MediaFlowBinding = {
  peer: string;
  direction: 'outbound' | 'inbound';
  kind: string;
  trackId: string | null;
  readyState: string;
  mid: string | null;
  statsId: string | null;
  ssrc: number | null;
  bytesSent: number | null;
  bytesReceived: number | null;
  trackIdentifier: string | null;
  remoteSid: string | null;
  statsError: string | null;
};

export type MediaFlowSelectedPair = {
  source: 'transport-selected-id' | 'pair-selected-flag';
  state: string;
};

export type MediaFlowPeerSnapshot = {
  ref: string;
  iceConnectionState: string;
  connectionState: string;
  selectedPair: MediaFlowSelectedPair | null;
  pairStatsError: string | null;
  iceCandidateErrors: string[];
  bindings: MediaFlowBinding[];
};

export type MediaFlowSnapshot = {
  instrumented: true;
  pcCount: number;
  peers: MediaFlowPeerSnapshot[];
};

export type RemoteAudioMirror = {
  participantSid: string;
  trackIds: string[];
};

export function installMediaFlowObserver(): void {
  if (Reflect.get(window, '__avMediaFlowReady') === true) return;
  const NativePeerConnection = window.RTCPeerConnection;
  if (typeof NativePeerConnection !== 'function') {
    Reflect.set(window, '__avMediaFlowError', 'rtc-peer-connection-unavailable');
    return;
  }

  const ICE_CONNECTION_STATES = ['new', 'checking', 'connected', 'completed', 'disconnected', 'failed', 'closed'];
  const PEER_CONNECTION_STATES = ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed'];
  const MEDIA_KINDS = ['audio', 'video'];
  const TRACK_STATES = ['live', 'ended'];
  const PAIR_STATES = ['frozen', 'waiting', 'in-progress', 'failed', 'succeeded', 'cancelled'];

  type TrackEvent = { t: number; kind: string; trackId: string; participantSid: string; streamId: string };
  type ObservedPeer = {
    ref: string;
    pc: RTCPeerConnection;
    trackEvents: TrackEvent[];
    iceCandidateErrors: string[];
  };

  const peers: ObservedPeer[] = [];
  let peerCounter = 0;
  const startedAt = performance.now();
  const now = (): number => Math.max(0, Math.round(performance.now() - startedAt));

  const asEnum = (allowed: string[], value: unknown): string =>
    typeof value === 'string' && allowed.indexOf(value) >= 0 ? value : 'unknown';
  const asFiniteNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  const asStringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

  // Mirrors livekit-client 2.22.3 unpackStreamId: '<participantSid>|<rest>'.
  const participantSidFromStreamId = (streamId: string): string => {
    const separator = streamId.indexOf('|');
    return separator < 0 ? streamId : streamId.slice(0, separator);
  };

  const instrument = (pc: RTCPeerConnection): void => {
    const peer: ObservedPeer = { ref: `pc-${peerCounter}`, pc, trackEvents: [], iceCandidateErrors: [] };
    peerCounter += 1;
    peers.push(peer);
    pc.addEventListener('track', (event: RTCTrackEvent) => {
      const track = event.track;
      const stream = event.streams.length > 0 ? event.streams[0] : undefined;
      if (!track || !stream) return;
      peer.trackEvents.push({
        t: now(),
        kind: asEnum(MEDIA_KINDS, track.kind),
        trackId: track.id,
        participantSid: participantSidFromStreamId(stream.id),
        streamId: stream.id,
      });
    });
    pc.addEventListener('icecandidateerror', (event: RTCPeerConnectionIceErrorEvent) => {
      const code = asFiniteNumber(event.errorCode);
      // Neutral telemetry only: the numeric code, no endpoint data, no
      // policy change. A 701 signals server reachability trouble, which is
      // a finding, never a proven DNS cause.
      peer.iceCandidateErrors.push(code === null ? 'error-code-unknown' : `error-code-${code}`);
    });
  };

  const midForSender = (pc: RTCPeerConnection, sender: RTCRtpSender): string | null => {
    try {
      const transceiver = pc.getTransceivers().find((candidate) => candidate.sender === sender);
      return transceiver && typeof transceiver.mid === 'string' ? transceiver.mid : null;
    } catch {
      return null;
    }
  };

  const midForReceiver = (pc: RTCPeerConnection, receiver: RTCRtpReceiver): string | null => {
    try {
      const transceiver = pc.getTransceivers().find((candidate) => candidate.receiver === receiver);
      return transceiver && typeof transceiver.mid === 'string' ? transceiver.mid : null;
    } catch {
      return null;
    }
  };

  const snapshotBindings = async (peer: ObservedPeer): Promise<MediaFlowBinding[]> => {
    const pc = peer.pc;
    const bindings: MediaFlowBinding[] = [];
    for (const sender of pc.getSenders()) {
      const track = sender.track;
      const base = {
        peer: peer.ref,
        direction: 'outbound' as const,
        kind: track ? asEnum(MEDIA_KINDS, track.kind) : 'unknown',
        trackId: track ? track.id : null,
        readyState: track ? asEnum(TRACK_STATES, track.readyState) : 'unknown',
        mid: midForSender(pc, sender),
        remoteSid: null,
      };
      if (typeof sender.getStats !== 'function') {
        bindings.push({
          ...base,
          statsId: null,
          ssrc: null,
          bytesSent: null,
          bytesReceived: null,
          trackIdentifier: null,
          statsError: 'sender-stats-unsupported',
        });
        continue;
      }
      let report: RTCStatsReport;
      try {
        report = await sender.getStats();
      } catch {
        bindings.push({
          ...base,
          statsId: null,
          ssrc: null,
          bytesSent: null,
          bytesReceived: null,
          trackIdentifier: null,
          statsError: 'get-stats-failed',
        });
        continue;
      }
      let pushed = false;
      report.forEach((entry) => {
        const raw = asRecord(entry);
        if (!raw || raw['type'] !== 'outbound-rtp') return;
        pushed = true;
        bindings.push({
          ...base,
          statsId: asStringOrNull(raw['id']),
          ssrc: asFiniteNumber(raw['ssrc']),
          bytesSent: asFiniteNumber(raw['bytesSent']),
          bytesReceived: asFiniteNumber(raw['bytesReceived']),
          trackIdentifier: asStringOrNull(raw['trackIdentifier']),
          statsError: null,
        });
      });
      if (!pushed) {
        bindings.push({
          ...base,
          statsId: null,
          ssrc: null,
          bytesSent: null,
          bytesReceived: null,
          trackIdentifier: null,
          statsError: 'no-outbound-rtp-row',
        });
      }
    }
    for (const receiver of pc.getReceivers()) {
      const track = receiver.track;
      const event = track ? peer.trackEvents.find((candidate) => candidate.trackId === track.id) : undefined;
      const base = {
        peer: peer.ref,
        direction: 'inbound' as const,
        kind: track ? asEnum(MEDIA_KINDS, track.kind) : 'unknown',
        trackId: track ? track.id : null,
        readyState: track ? asEnum(TRACK_STATES, track.readyState) : 'unknown',
        mid: midForReceiver(pc, receiver),
        remoteSid: event ? event.participantSid : null,
      };
      if (typeof receiver.getStats !== 'function') {
        bindings.push({
          ...base,
          statsId: null,
          ssrc: null,
          bytesSent: null,
          bytesReceived: null,
          trackIdentifier: null,
          statsError: 'receiver-stats-unsupported',
        });
        continue;
      }
      let report: RTCStatsReport;
      try {
        report = await receiver.getStats();
      } catch {
        bindings.push({
          ...base,
          statsId: null,
          ssrc: null,
          bytesSent: null,
          bytesReceived: null,
          trackIdentifier: null,
          statsError: 'get-stats-failed',
        });
        continue;
      }
      let pushed = false;
      report.forEach((entry) => {
        const raw = asRecord(entry);
        if (!raw || raw['type'] !== 'inbound-rtp') return;
        pushed = true;
        bindings.push({
          ...base,
          statsId: asStringOrNull(raw['id']),
          ssrc: asFiniteNumber(raw['ssrc']),
          bytesSent: asFiniteNumber(raw['bytesSent']),
          bytesReceived: asFiniteNumber(raw['bytesReceived']),
          trackIdentifier: asStringOrNull(raw['trackIdentifier']),
          statsError: null,
        });
      });
      if (!pushed) {
        bindings.push({
          ...base,
          statsId: null,
          ssrc: null,
          bytesSent: null,
          bytesReceived: null,
          trackIdentifier: null,
          statsError: 'no-inbound-rtp-row',
        });
      }
    }
    return bindings;
  };

  const PatchedPeerConnection = new Proxy(NativePeerConnection, {
    construct(target, args, newTarget) {
      const pc = Reflect.construct(target, args, newTarget) as RTCPeerConnection;
      try {
        instrument(pc);
      } catch {
        Reflect.set(window, '__avMediaFlowError', 'instrumentation-failed');
      }
      return pc;
    },
  });
  Reflect.set(window, '__avMediaFlowReady', true);
  window.RTCPeerConnection = PatchedPeerConnection;
  Reflect.set(window, '__avMediaFlowSnapshot', async (): Promise<MediaFlowSnapshot> => {
    const outPeers: MediaFlowPeerSnapshot[] = [];
    for (const peer of peers) {
      const pc = peer.pc;
      const bindings = await snapshotBindings(peer);
      let selectedPair: MediaFlowSelectedPair | null = null;
      let pairStatsError: string | null = null;
      try {
        const report = await pc.getStats();
        let transportSelected: string | null = null;
        const pairs: Array<{ ref: string; state: string; selected: boolean }> = [];
        report.forEach((entry) => {
          const raw = asRecord(entry);
          if (!raw) return;
          if (raw['type'] === 'transport' && typeof raw['selectedCandidatePairId'] === 'string') {
            transportSelected = raw['selectedCandidatePairId'];
          } else if (raw['type'] === 'candidate-pair' && typeof raw['id'] === 'string') {
            pairs.push({
              ref: raw['id'],
              state: asEnum(PAIR_STATES, raw['state']),
              selected: raw['selected'] === true,
            });
          }
        });
        const viaTransport =
          transportSelected !== null ? pairs.find((pair) => pair.ref === transportSelected) : undefined;
        const pair = viaTransport ?? pairs.find((candidate) => candidate.selected);
        if (pair) {
          selectedPair = {
            source: viaTransport && pair.ref === transportSelected ? 'transport-selected-id' : 'pair-selected-flag',
            state: pair.state,
          };
        }
      } catch {
        pairStatsError = 'get-stats-failed';
      }
      outPeers.push({
        ref: peer.ref,
        iceConnectionState: asEnum(ICE_CONNECTION_STATES, pc.iceConnectionState),
        connectionState: asEnum(PEER_CONNECTION_STATES, pc.connectionState),
        selectedPair,
        pairStatsError,
        iceCandidateErrors: peer.iceCandidateErrors.slice(),
        bindings,
      });
    }
    return { instrumented: true, pcCount: outPeers.length, peers: outPeers };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBinding(value: unknown, peer: string): MediaFlowBinding | null {
  if (!isRecord(value)) return null;
  if (value['peer'] !== peer) return null;
  if (value['direction'] !== 'outbound' && value['direction'] !== 'inbound') return null;
  const text = ['kind', 'readyState'];
  for (const key of text) {
    if (typeof value[key] !== 'string') return null;
  }
  const nullableText = ['trackId', 'mid', 'statsId', 'trackIdentifier', 'remoteSid', 'statsError'];
  for (const key of nullableText) {
    const entry = value[key];
    if (entry !== null && typeof entry !== 'string') return null;
  }
  const ssrc = value['ssrc'];
  const bytesSent = value['bytesSent'];
  const bytesReceived = value['bytesReceived'];
  if (ssrc !== null && typeof ssrc !== 'number') return null;
  if (bytesSent !== null && typeof bytesSent !== 'number') return null;
  if (bytesReceived !== null && typeof bytesReceived !== 'number') return null;
  return {
    peer,
    direction: value['direction'],
    kind: value['kind'] as string,
    trackId: value['trackId'] as string | null,
    readyState: value['readyState'] as string,
    mid: value['mid'] as string | null,
    statsId: value['statsId'] as string | null,
    ssrc,
    bytesSent,
    bytesReceived,
    trackIdentifier: value['trackIdentifier'] as string | null,
    remoteSid: value['remoteSid'] as string | null,
    statsError: value['statsError'] as string | null,
  };
}

function parseSnapshot(raw: unknown): MediaFlowSnapshot {
  if (!isRecord(raw) || raw['instrumented'] !== true || !Array.isArray(raw['peers'])) {
    throw new Error('media-flow-incomplete');
  }
  const peers: MediaFlowPeerSnapshot[] = [];
  for (const entry of raw['peers']) {
    if (!isRecord(entry) || typeof entry['ref'] !== 'string') throw new Error('media-flow-incomplete');
    if (typeof entry['iceConnectionState'] !== 'string' || typeof entry['connectionState'] !== 'string') {
      throw new Error('media-flow-incomplete');
    }
    if (!Array.isArray(entry['bindings']) || !Array.isArray(entry['iceCandidateErrors'])) {
      throw new Error('media-flow-incomplete');
    }
    const errors: string[] = [];
    for (const code of entry['iceCandidateErrors']) {
      if (typeof code !== 'string') throw new Error('media-flow-incomplete');
      errors.push(code);
    }
    const bindings: MediaFlowBinding[] = [];
    for (const row of entry['bindings']) {
      const binding = parseBinding(row, entry['ref']);
      if (binding === null) throw new Error('media-flow-incomplete');
      bindings.push(binding);
    }
    let selectedPair: MediaFlowSelectedPair | null = null;
    const rawPair = entry['selectedPair'];
    if (rawPair !== null) {
      if (!isRecord(rawPair) || typeof rawPair['state'] !== 'string') throw new Error('media-flow-incomplete');
      if (rawPair['source'] !== 'transport-selected-id' && rawPair['source'] !== 'pair-selected-flag') {
        throw new Error('media-flow-incomplete');
      }
      selectedPair = { source: rawPair['source'], state: rawPair['state'] };
    }
    const pairStatsError = entry['pairStatsError'];
    if (pairStatsError !== null && typeof pairStatsError !== 'string') throw new Error('media-flow-incomplete');
    peers.push({
      ref: entry['ref'],
      iceConnectionState: entry['iceConnectionState'],
      connectionState: entry['connectionState'],
      selectedPair,
      pairStatsError: pairStatsError,
      iceCandidateErrors: errors,
      bindings,
    });
  }
  return { instrumented: true, pcCount: peers.length, peers };
}

/**
 * Reads the test-side snapshot. Rejects loudly when the observer was not
 * installed (addInitScript must run before app navigation) or when the
 * payload is incomplete.
 */
export async function readMediaFlowSnapshot(page: Page): Promise<MediaFlowSnapshot> {
  const raw: unknown = await page.evaluate(() => {
    if (Reflect.get(window, '__avMediaFlowReady') !== true) {
      throw new Error('media-flow-not-installed');
    }
    const snapshot = Reflect.get(window, '__avMediaFlowSnapshot');
    if (typeof snapshot !== 'function') throw new Error('media-flow-not-installed');
    return (snapshot as () => Promise<unknown>)();
  });
  return parseSnapshot(raw);
}

/**
 * Stable measurement key for one native binding: peerRef + direction +
 * trackId + RTP stats id/ssrc. The key is chosen once, then the very same
 * counter is probed twice (>0, then growth). Never a kind-wide sum.
 */
export function bindingKey(binding: MediaFlowBinding): string {
  return [
    binding.peer,
    binding.direction,
    binding.trackId ?? '',
    binding.statsId ?? '',
    String(binding.ssrc ?? ''),
  ].join('|');
}

export function findBinding(snapshot: MediaFlowSnapshot, key: string): MediaFlowBinding | null {
  for (const peer of snapshot.peers) {
    for (const binding of peer.bindings) {
      if (bindingKey(binding) === key) return binding;
    }
  }
  return null;
}

// H1: the key is chosen from TWO consecutive snapshots. A row qualifies
// only with the same full bindingKey in both snapshots, native stats
// identity, and a finite non-negative counter where current exceeds
// previous; the largest delta wins, so a small growing layer beats a
// large paused one. No sums across ssrcs or tracks.
function selectGrownKey(
  previous: MediaFlowSnapshot,
  current: MediaFlowSnapshot,
  kind: 'audio' | 'video',
  track: { peer: string; trackId: string },
  direction: 'outbound' | 'inbound',
  sid: string | null,
): MediaFlowBinding {
  const bytesOf = (binding: MediaFlowBinding): number | null =>
    direction === 'outbound' ? binding.bytesSent : binding.bytesReceived;
  const before = new Map<string, MediaFlowBinding>();
  for (const binding of previous.peers.flatMap((peer) => peer.bindings)) {
    before.set(bindingKey(binding), binding);
  }
  const usable = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;
  let identityGap = false;
  let winner: MediaFlowBinding | null = null;
  let bestDelta = 0;
  for (const row of current.peers.flatMap((peer) => peer.bindings)) {
    if (row.direction !== direction || row.kind !== kind) continue;
    if (row.peer !== track.peer || row.trackId !== track.trackId) continue;
    if (row.readyState !== 'live' || row.statsError !== null) continue;
    if (direction === 'inbound' && row.remoteSid !== sid) continue;
    if (row.statsId === null && row.ssrc === null) {
      identityGap = true;
      continue;
    }
    const old = before.get(bindingKey(row));
    const oldBytes = old && old.statsError === null ? bytesOf(old) : null;
    const nowBytes = bytesOf(row);
    if (!usable(oldBytes) || !usable(nowBytes)) continue;
    if (nowBytes <= oldBytes) continue;
    const delta = nowBytes - oldBytes;
    if (delta <= bestDelta) continue;
    bestDelta = delta;
    winner = row;
  }
  if (winner) return winner;
  const gap = identityGap ? 'native stats identity missing' : 'no byte growth between two snapshots';
  throw new Error(`media-flow-no-${direction}-${kind}: ${gap} yet.`);
}

export function selectOutbound(
  previous: MediaFlowSnapshot,
  current: MediaFlowSnapshot,
  kind: 'audio' | 'video',
  track: { peer: string; trackId: string },
): string {
  return bindingKey(selectGrownKey(previous, current, kind, track, 'outbound', null));
}

export function selectInbound(
  previous: MediaFlowSnapshot,
  current: MediaFlowSnapshot,
  kind: 'audio' | 'video',
  track: { peer: string; trackId: string },
  sid: string,
): string {
  const winner = selectGrownKey(previous, current, kind, track, 'inbound', sid);
  if (winner.trackIdentifier !== null && winner.trackIdentifier !== winner.trackId) {
    throw new Error(`media-flow-trackidentifier-mismatch: native trackIdentifier disagrees with receiver track id.`);
  }
  return bindingKey(winner);
}

/**
 * Distinct remote participantSids seen on inbound bindings of the given
 * kind with a live track. More than one means ambiguity or an unexpected
 * third party and must fail the mapping, never pick a first track.
 */
export function inboundRemoteSids(snapshot: MediaFlowSnapshot, kind: 'audio' | 'video'): string[] {
  const sids = new Set<string>();
  for (const peer of snapshot.peers) {
    for (const binding of peer.bindings) {
      if (binding.direction === 'inbound' && binding.kind === kind && binding.trackId !== null && binding.remoteSid) {
        sids.add(binding.remoteSid);
      }
    }
  }
  return [...sids].sort();
}

export async function attachMediaFlowSnapshot(testInfo: TestInfo, name: string, payload: unknown): Promise<void> {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
    contentType: 'application/json',
  });
}

/**
 * Mirrors the product DOM contract (useGlobalAudioTracks: audio elements
 * carry the LiveKit participantSid in data-av-remote). Returns the exact
 * native srcObject audio track ids per sid, not just counts.
 */
export async function readRemoteAudioMirrors(page: Page): Promise<RemoteAudioMirror[]> {
  const raw: unknown = await page.evaluate(() => {
    const elements = document.querySelectorAll<HTMLAudioElement>('audio[data-av-remote]');
    return Array.from(elements).map((audio) => {
      const sid = audio.dataset['avRemote'] ?? '';
      const src = audio.srcObject;
      const ids: string[] =
        typeof MediaStream === 'function' && src instanceof MediaStream
          ? src.getAudioTracks().map((track) => track.id)
          : [];
      return { participantSid: sid, trackIds: ids };
    });
  });
  if (!Array.isArray(raw)) throw new Error('audio-mirror-incomplete');
  const out: RemoteAudioMirror[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry['participantSid'] !== 'string') throw new Error('audio-mirror-incomplete');
    if (!Array.isArray(entry['trackIds']) || entry['trackIds'].some((id) => typeof id !== 'string')) {
      throw new Error('audio-mirror-incomplete');
    }
    out.push({ participantSid: entry['participantSid'], trackIds: entry['trackIds'] as string[] });
  }
  return out;
}
