import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

import { test as mediaFlowTest } from '../fixtures';
import type { RoomUsersFactory, TestStackEnv } from '../fixtures';
import { appRouteUrl, waitForParticipant } from '../fixtures/helpers';
import {
  attachMediaFlowSnapshot,
  findBinding,
  inboundRemoteSids,
  installMediaFlowObserver,
  readMediaFlowSnapshot,
  readRemoteAudioMirrors,
  selectInbound,
  selectOutbound,
} from './mediaFlow';
import type { MediaFlowBinding, MediaFlowSnapshot } from './mediaFlow';

/**
 * Media flow: two independent per-kind tests (audio, video) over one shared parametrized flow.
 *
 * Each test checks only its own measured capture capability from
 * testInfo.project.metadata.capabilities (audio -> getUserMediaAudio,
 * video -> getUserMediaVideo). Only a measured boolean false skips via
 * M1 section 7 with project and capability named, before try/catch and
 * before roomUsers. Unknown metadata is a setup gap and fails loudly.
 * A skip is a measurement boundary, never an AV pass; no skips seen.
 * No webrtcLoopback, ICE, pair, browser-name or env skip exists here,
 * and no bypass switch overrides a measured capability.
 *
 * Fixed proof order per kind: capture live sender track (no RTP filter),
 * outbound ICE/PC/pair, outbound RTP key on the same track, inbound
 * mapping plus ICE/PC/pair, inbound RTP keys on the same receiver track.
 * Proof comes only from the same native counter (peerRef + direction +
 * trackId + stats id/ssrc) read twice (>0, then growth); kind-wide sums
 * are diagnostics only, never proof.
 */

type MediaKind = 'audio' | 'video';

// One living native track, bound by handle identity. Chosen once without
// any RTP row, then reused for ICE refs and RTP key selection.
type CapturedTrack = { peer: string; kind: MediaKind; trackId: string };

function capabilityName(kind: MediaKind): string {
  return kind === 'audio' ? 'getUserMediaAudio' : 'getUserMediaVideo';
}

// Measured capture capability for this project and kind; null when unknown.
function readCaptureCapability(testInfo: TestInfo, kind: MediaKind): boolean | null {
  const metadata: unknown = testInfo.project.metadata;
  if (typeof metadata !== 'object' || metadata === null) return null;
  const capabilities: unknown = (metadata as Record<string, unknown>)['capabilities'];
  if (typeof capabilities !== 'object' || capabilities === null) return null;
  const value: unknown = (capabilities as Record<string, unknown>)[capabilityName(kind)];
  return typeof value === 'boolean' ? value : null;
}

// M1 section 7: only a measured false skips, before try/catch and roomUsers; project and capability named.
function requireMeasuredCapture(testInfo: TestInfo, kind: MediaKind): void {
  const flag = readCaptureCapability(testInfo, kind);
  if (flag === false) {
    mediaFlowTest.skip(
      true,
      `[M1§7] project "${testInfo.project.name}": metadata.capabilities.${capabilityName(kind)} ` +
        `measured false, ${kind} capture not measurable here; skip is a measurement boundary, not an AV pass.`,
    );
    return;
  }
  if (flag !== true) {
    throw new Error(
      `setup measurement gap: project "${testInfo.project.name}" has no boolean ` +
        `metadata.capabilities.${capabilityName(kind)}; refusing to skip as measured-missing.`,
    );
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dedupTracks(bindings: MediaFlowBinding[]): CapturedTrack[] {
  const unique = new Map<string, CapturedTrack>();
  for (const binding of bindings) {
    if (binding.trackId === null) continue;
    const key = `${binding.peer}|${binding.trackId}|${binding.kind}`;
    if (!unique.has(key)) {
      unique.set(key, { peer: binding.peer, kind: binding.kind as MediaKind, trackId: binding.trackId });
    }
  }
  return [...unique.values()];
}

// Local live-track proof of the tested kind only: outbound sender when
// expectedSid is null, inbound receiver for that sid otherwise. Live
// handle only, never RTP rows or stats errors; ambiguity fails loudly.
function captureLiveTrack(
  snapshot: MediaFlowSnapshot,
  role: string,
  kind: MediaKind,
  expectedSid: string | null,
): CapturedTrack {
  const where = expectedSid === null ? `outbound ${kind} sender` : `inbound ${kind} receiver`;
  const matches = dedupTracks(
    snapshot.peers
      .flatMap((peer) => peer.bindings)
      .filter(
        (binding) =>
          binding.kind === kind &&
          binding.trackId !== null &&
          binding.readyState === 'live' &&
          (expectedSid === null
            ? binding.direction === 'outbound'
            : binding.direction === 'inbound' && binding.remoteSid === expectedSid),
      ),
  ).filter((track) => track.kind === kind);
  if (matches.length === 0) throw new Error(`${role}: capture found no live ${where} track.`);
  const winner = matches[0];
  if (matches.length > 1 || !winner) {
    throw new Error(`${role}: capture ambiguous with ${matches.length} live ${where} tracks; refusing to pick one.`);
  }
  return winner;
}

// ICE/PC/pair proof for one concrete ref: ICE connected/completed, PC
// connected, selected pair succeeded. Never every ever-observed PC.
async function awaitPeerMediaReady(page: Page, role: string, ref: string, phase: string): Promise<void> {
  try {
    await expect
      .poll(
        async () => {
          try {
            const snapshot = await readMediaFlowSnapshot(page);
            const peer = snapshot.peers.find((candidate) => candidate.ref === ref);
            return (
              peer !== undefined &&
              (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') &&
              peer.connectionState === 'connected' &&
              peer.selectedPair !== null &&
              peer.selectedPair.state === 'succeeded'
            );
          } catch {
            return false;
          }
        },
        { timeout: 25_000, intervals: [500] },
      )
      .toBe(true);
  } catch (error) {
    throw new Error(`${role}: ${phase} never reached ICE/PC connected with a succeeded pair: ${errorText(error)}`);
  }
}

// Two-snapshot readiness: the first read sets the basis, byte growth picks the key.
async function awaitStatsKey(page: Page, role: string, capture: CapturedTrack, sid: string | null): Promise<string> {
  const direction = sid === null ? 'outbound' : 'inbound';
  let key: string | null = null;
  let lastError: unknown = null;
  let previous: MediaFlowSnapshot | null = null;
  await expect
    .poll(
      async () => {
        try {
          const current = await readMediaFlowSnapshot(page);
          const basis = previous;
          previous = current;
          if (basis === null) return null;
          key =
            sid === null
              ? selectOutbound(basis, current, capture.kind, capture)
              : selectInbound(basis, current, capture.kind, capture, sid);
          return key;
        } catch (error) {
          lastError = error;
          previous = null;
          return null;
        }
      },
      { timeout: 15_000, intervals: [500] },
    )
    .not.toBeNull()
    .catch((error: unknown) => {
      throw new Error(`${role}: ${direction} ${capture.kind} stats readiness failed: ${errorText(lastError ?? error)}`);
    });
  if (!key) throw new Error(`${role}: ${direction} ${capture.kind} stats never produced a native RTP row.`);
  return key;
}

function byteReader(page: Page, key: string, direction: 'outbound' | 'inbound'): () => Promise<number> {
  return async () => {
    try {
      const snapshot = await readMediaFlowSnapshot(page);
      const binding = findBinding(snapshot, key);
      if (!binding || binding.statsError !== null) return -1;
      const value = direction === 'outbound' ? binding.bytesSent : binding.bytesReceived;
      return value === null ? -1 : value;
    } catch {
      return -1;
    }
  };
}

async function proveFlow(
  page: Page,
  role: string,
  label: string,
  key: string,
  direction: 'outbound' | 'inbound',
): Promise<void> {
  const read = byteReader(page, key, direction);
  await expect.poll(read, { timeout: 15_000, intervals: [500] }).toBeGreaterThan(0);
  const first = await read();
  if (first <= 0) throw new Error(`${role}: ${label} unreadable between polls.`);
  await expect.poll(read, { timeout: 10_000, intervals: [500] }).toBeGreaterThan(first);
}

async function attachFlow(testInfo: TestInfo, phase: string, role: string, page: Page): Promise<void> {
  const snapshot: MediaFlowSnapshot = await readMediaFlowSnapshot(page);
  await attachMediaFlowSnapshot(testInfo, `media-flow-${phase}-${role}`, { role, phase, snapshot });
}

// Facts about video elements and native srcObject track ids; see attachRemoteVideoState.
type VideoElementFacts = {
  trackIds: string[];
  visible: boolean;
  rectWidth: number;
  rectHeight: number;
  readyState: number;
  paused: boolean;
  videoWidth: number;
  videoHeight: number;
};

function parseVideoFacts(raw: unknown): VideoElementFacts[] {
  if (!Array.isArray(raw)) throw new Error('video-facts-incomplete');
  const numbers = ['rectWidth', 'rectHeight', 'readyState', 'videoWidth', 'videoHeight'];
  return raw.map((entry) => {
    if (typeof entry !== 'object' || entry === null) throw new Error('video-facts-incomplete');
    const record = entry as Record<string, unknown>;
    const trackIds = record['trackIds'];
    if (
      !Array.isArray(trackIds) ||
      trackIds.some((id) => typeof id !== 'string') ||
      typeof record['visible'] !== 'boolean' ||
      typeof record['paused'] !== 'boolean' ||
      numbers.some((key) => typeof record[key] !== 'number')
    ) {
      throw new Error('video-facts-incomplete');
    }
    return {
      trackIds: trackIds as string[],
      visible: record['visible'],
      rectWidth: record['rectWidth'] as number,
      rectHeight: record['rectHeight'] as number,
      readyState: record['readyState'] as number,
      paused: record['paused'],
      videoWidth: record['videoWidth'] as number,
      videoHeight: record['videoHeight'] as number,
    };
  });
}

async function readVideoElementFacts(page: Page): Promise<VideoElementFacts[]> {
  const raw: unknown = await page.evaluate(() => {
    const elements = document.querySelectorAll<HTMLVideoElement>('video');
    return Array.from(elements).map((video) => {
      const src = video.srcObject;
      const rect = video.getBoundingClientRect();
      const style = getComputedStyle(video);
      const opacity = style.opacity === '' ? 1 : Number(style.opacity);
      const cssShown = style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
      return {
        trackIds:
          typeof MediaStream === 'function' && src instanceof MediaStream
            ? src.getVideoTracks().map((track) => track.id)
            : [],
        visible: rect.width > 0 && rect.height > 0 && cssShown && opacity > 0,
        rectWidth: rect.width,
        rectHeight: rect.height,
        readyState: video.readyState,
        paused: video.paused,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      };
    });
  });
  return parseVideoFacts(raw);
}

// Neutral remote-video observation for the video test only, attached from
// the finally path so failures keep their rendering diagnosis. Element
// track ids match inbound video bindings by native id; a local preview
// never counts as remote video. Unknown or ambiguous sid is null.
// Visibility is a neutral geometry/CSS observation, not an occlusion
// proof; remoteVideoRendered needs a real match plus visibility. No src,
// href, SDP, ICE URLs, hosts or keys; no UI, no capture override. A read
// error here never replaces the original failure.
async function attachRemoteVideoState(testInfo: TestInfo, page: Page, role: string): Promise<void> {
  const snapshot = await readMediaFlowSnapshot(page);
  const inbound = snapshot.peers
    .flatMap((peer) => peer.bindings)
    .filter(
      (binding) =>
        binding.direction === 'inbound' &&
        binding.kind === 'video' &&
        binding.trackId !== null &&
        binding.remoteSid !== null,
    );
  const sids = [...new Set(inbound.map((binding) => binding.remoteSid as string))].sort();
  const expected = sids.length === 1 ? sids[0] : null;
  const ids = new Set(
    inbound.filter((binding) => binding.remoteSid === expected).map((binding) => binding.trackId as string),
  );
  const videos = await readVideoElementFacts(page);
  const hits = videos.filter((video) => video.trackIds.some((id) => ids.has(id)));
  await attachMediaFlowSnapshot(testInfo, `media-flow-remote-video-${role}`, {
    role,
    sid: hits.length > 0 ? expected : null,
    remoteVideoObserved: hits.length > 0,
    remoteVideoRendered: hits.some((video) => video.visible),
    videos,
  });
}

// Shared per-kind flow, parametrized by kind instead of copied. The audio
// test only enables the mic and requires no video; the video test is
// fully independent of audio with no mic switch and no audio expectation.
async function runMediaFlowKind(
  kind: MediaKind,
  fixtures: { roomUsers: RoomUsersFactory; stack: TestStackEnv },
  testInfo: TestInfo,
): Promise<void> {
  const failures: unknown[] = [];
  let ownerPage: Page | null = null;
  let memberPage: Page | null = null;

  const pages = (): Array<[Page, string]> => {
    if (!ownerPage || !memberPage) throw new Error('pages not ready for finally block.');
    return [
      [ownerPage, 'owner'],
      [memberPage, 'member'],
    ];
  };

  try {
    const participants = await fixtures.roomUsers(2, { tenant: 'seed', join: false });
    const [owner, member] = participants;
    if (!owner || !member || participants.length !== 2) {
      throw new Error('roomUsers did not create exactly two participants.');
    }
    ownerPage = owner.page;
    memberPage = member.page;

    // Observer before app navigation so the native constructor is wrapped first.
    await ownerPage.addInitScript(installMediaFlowObserver);
    await memberPage.addInitScript(installMediaFlowObserver);

    await ownerPage.goto(appRouteUrl(fixtures.stack.baseUrl, 'app'));
    await memberPage.goto(appRouteUrl(fixtures.stack.baseUrl, 'app'));

    await waitForParticipant(ownerPage, member.user);
    await waitForParticipant(memberPage, owner.user);

    // Fresh invited users see the onboarding wizard (WorldShell, onboardingCompleted
    // false) over the room on first sign-in; it intercepts clicks on the AV bar.
    // Complete it with "Get started" (onboarding.cta), as smoke/av-state.spec.ts does.
    for (const participant of [owner, member]) {
      const welcome = participant.page.getByRole('heading', { name: `Welcome, ${participant.user.displayName}!` });
      await expect(welcome).toBeVisible();
      await participant.page.getByRole('button', { name: 'Get started', exact: true }).click();
      await welcome.waitFor({ state: 'detached' });
    }

    // Fail fast on instrumentation gaps, never an empty synthetic snapshot.
    await readMediaFlowSnapshot(ownerPage);
    await readMediaFlowSnapshot(memberPage);

    if (kind === 'audio') {
      // Microphone on via the real product toggle (localized title
      // av.micOn/av.micOff, anchored so "Mute" never matches "Unmute").
      // Only the off state is clicked; afterwards the on state must be
      // visible and unique, mirroring the camera proof.
      for (const [page, role] of pages()) {
        const micOff = page.getByTitle(/^mikrofon einschalten/i).or(page.getByTitle(/^unmute microphone/i));
        const micOn = page.getByTitle(/^mikrofon ausschalten/i).or(page.getByTitle(/^mute microphone/i));
        const micToggle = micOff.or(micOn);
        await expect(micToggle, `${role}: microphone toggle never became visible`).toBeVisible({ timeout: 30_000 });
        await expect(micToggle, `${role}: microphone toggle is not unique`).toHaveCount(1);
        if ((await micOff.count()) > 0) await micOff.click();
        await expect(micOn, `${role}: microphone did not switch on`).toBeVisible({ timeout: 30_000 });
        await expect(micOn, `${role}: microphone on toggle is not unique`).toHaveCount(1);
      }
    } else {
      // Camera on via the real rendered button selected by its source
      // icon (Lucide Video/VideoOff render svg.lucide-video(-off)).
      // No .bg-button class. A11y finding (no product patch): the cam
      // toggle exposes no accessible name, so no getByRole name is
      // fabricated and uniqueness uses toHaveCount(1), never first/nth.
      for (const [page, role] of pages()) {
        const camOff = page.locator('button:has(svg.lucide-video-off)');
        const camOn = page.locator('button:has(svg.lucide-video)');
        const camToggle = camOff.or(camOn);
        await expect(camToggle, `${role}: camera toggle never became visible`).toBeVisible({ timeout: 30_000 });
        await expect(camToggle, `${role}: camera toggle is not unique`).toHaveCount(1);
        if ((await camOff.count()) > 0) await camOff.click();
        await expect(camOn, `${role}: camera did not switch on`).toHaveCount(1);
      }
    }

    // Phase capture: one living sender track of the tested kind per page
    // as {peer, kind, trackId}; live handle only, never RTP rows.
    const captures = new Map<string, CapturedTrack>();
    for (const [page, role] of pages()) {
      let capture: CapturedTrack | null = null;
      await expect
        .poll(
          async () => {
            try {
              const snapshot = await readMediaFlowSnapshot(page);
              capture = captureLiveTrack(snapshot, role, kind, null);
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 10_000, intervals: [500] },
        )
        .toBe(true);
      if (!capture) throw new Error(`${role}: capture found no live outbound ${kind} sender track.`);
      captures.set(role, capture);
      await attachFlow(testInfo, `capture-${kind}`, role, page);
    }
    const mustCapture = (role: string): CapturedTrack => {
      const capture = captures.get(role);
      if (!capture) throw new Error(`${role}: missing ${kind} capture.`);
      return capture;
    };

    const keys = new Map<string, string>();
    const mustKey = (role: string, name: string): string => {
      const key = keys.get(`${role}:${name}`);
      if (!key) throw new Error(`${role}: missing measurement key ${name}.`);
      return key;
    };

    // Phase outbound ICE: only the PC carrying the captured sender track
    // must be ICE connected/completed, PC connected, selected pair
    // succeeded. Waiting/frozen never counts.
    for (const [page, role] of pages()) {
      await awaitPeerMediaReady(page, role, mustCapture(role).peer, `outbound-ice-${kind}`);
      await attachFlow(testInfo, `outbound-ice-${kind}`, role, page);
    }

    // Phase outbound RTP: usable native RTP rows for the very same
    // captured track, key chosen once, same counter above zero + growth.
    for (const [page, role] of pages()) {
      keys.set(`${role}:out`, await awaitStatsKey(page, role, mustCapture(role), null));
    }
    for (const [page, role] of pages()) {
      await proveFlow(page, role, `outbound ${kind}`, mustKey(role, 'out'), 'outbound');
      await attachFlow(testInfo, `outbound-rtp-${kind}`, role, page);
    }

    // Expected peer mapping: exactly one other sid of the tested kind per
    // page; both pages see different sids. The PA prefix check is a
    // LiveKit-specific plausibility only; identity comes from the real
    // receiver/stream/sid linkage, never from the prefix.
    const sidOf = async (page: Page, role: string): Promise<string> => {
      await expect
        .poll(
          async (): Promise<MediaFlowSnapshot | null> => {
            try {
              const current = await readMediaFlowSnapshot(page);
              return inboundRemoteSids(current, kind).length > 0 ? current : null;
            } catch {
              return null;
            }
          },
          { timeout: 15_000, intervals: [500] },
        )
        .not.toBeNull();
      const current = await readMediaFlowSnapshot(page);
      const sids = inboundRemoteSids(current, kind);
      if (sids.length !== 1 || !sids[0]) {
        throw new Error(`${role}: expected exactly one remote ${kind} participant, saw ${sids.length}.`);
      }
      const sid = sids[0];
      if (!sid.startsWith('PA')) throw new Error(`${role}: remote sid has unexpected shape.`);
      return sid;
    };
    const ownerSees = await sidOf(ownerPage, 'owner');
    const memberSees = await sidOf(memberPage, 'member');
    if (ownerSees === memberSees) throw new Error('both pages observe the same remote sid; mapping ambiguous.');

    // Phase inbound mapping: exactly one living receiver track of the
    // tested kind per page and expected sid, before any inbound key or
    // RTP wait, independent of stats errors or rows.
    const inboundCaptures = new Map<string, CapturedTrack>();
    for (const [page, role, sid] of [
      [ownerPage, 'owner', ownerSees],
      [memberPage, 'member', memberSees],
    ] as Array<[Page, string, string]>) {
      let capture: CapturedTrack | null = null;
      let lastError: unknown = null;
      await expect
        .poll(
          async () => {
            try {
              const snapshot = await readMediaFlowSnapshot(page);
              capture = captureLiveTrack(snapshot, role, kind, sid);
              return true;
            } catch (error) {
              lastError = error;
              return false;
            }
          },
          { timeout: 15_000, intervals: [500] },
        )
        .toBe(true);
      if (!capture) {
        throw new Error(
          `${role}: inbound mapping found no unique live ${kind} receiver track: ${errorText(lastError)}`,
        );
      }
      inboundCaptures.set(role, capture);
      await attachFlow(testInfo, `inbound-mapping-${kind}`, role, page);
    }
    const mustInbound = (role: string): CapturedTrack => {
      const capture = inboundCaptures.get(role);
      if (!capture) throw new Error(`${role}: missing inbound ${kind} capture.`);
      return capture;
    };

    // Phase inbound ICE: the very PC carrying the mapped receiver track.
    for (const [page, role] of pages()) {
      await awaitPeerMediaReady(page, role, mustInbound(role).peer, `inbound-ice-${kind}`);
      await attachFlow(testInfo, `inbound-ice-${kind}`, role, page);
    }

    // Phase inbound RTP: native rows for the mapped receiver track,
    // fixed key, same counter above zero then growth.
    for (const [page, role, sid] of [
      [ownerPage, 'owner', ownerSees],
      [memberPage, 'member', memberSees],
    ] as Array<[Page, string, string]>) {
      keys.set(`${role}:in`, await awaitStatsKey(page, role, mustInbound(role), sid));
    }
    for (const [page, role] of pages()) {
      await proveFlow(page, role, `inbound ${kind}`, mustKey(role, 'in'), 'inbound');
      await attachFlow(testInfo, `inbound-rtp-${kind}`, role, page);
    }

    if (kind === 'audio') {
      // Audio DOM mirror: native srcObject ids must contain the receiver id.
      for (const [page, role, sid] of [
        [ownerPage, 'owner', ownerSees],
        [memberPage, 'member', memberSees],
      ] as Array<[Page, string, string]>) {
        const mirrors = await readRemoteAudioMirrors(page);
        const match = mirrors.find((mirror) => mirror.participantSid === sid);
        if (!match) throw new Error(`${role}: no audio mirror for the observed remote participant.`);
        const snapshot = await readMediaFlowSnapshot(page);
        const binding = findBinding(snapshot, mustKey(role, 'in'));
        if (!binding || !binding.trackId) throw new Error(`${role}: inbound audio binding lost its track.`);
        if (!match.trackIds.includes(binding.trackId)) {
          throw new Error(`${role}: audio mirror ids do not contain the inbound receiver track id.`);
        }
      }
    }
  } catch (error) {
    failures.push(error);
  } finally {
    for (const [page, role] of [
      [ownerPage, 'owner'],
      [memberPage, 'member'],
    ] as Array<[Page | null, string]>) {
      if (page === null) continue;
      try {
        await attachFlow(testInfo, `final-${kind}`, role, page);
      } catch (error) {
        testInfo.annotations.push({ type: 'diagnostic', description: `${role}: ${kind} final: ${errorText(error)}` });
      }
      if (kind === 'video') {
        try {
          await attachRemoteVideoState(testInfo, page, role);
        } catch (error) {
          const description = `${role}: ${kind} remote-video: ${errorText(error)}`;
          testInfo.annotations.push({ type: 'diagnostic', description });
        }
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, `media-flow ${kind} failed at several phases (see attachments).`);
    }
  }
}

mediaFlowTest('two-participant audio flow carries live bytes both ways', async ({ roomUsers, stack }, testInfo) => {
  mediaFlowTest.setTimeout(180_000);
  requireMeasuredCapture(testInfo, 'audio');
  await runMediaFlowKind('audio', { roomUsers, stack }, testInfo);
});

mediaFlowTest('two-participant video flow carries live bytes both ways', async ({ roomUsers, stack }, testInfo) => {
  mediaFlowTest.setTimeout(180_000);
  requireMeasuredCapture(testInfo, 'video');
  await runMediaFlowKind('video', { roomUsers, stack }, testInfo);
});
