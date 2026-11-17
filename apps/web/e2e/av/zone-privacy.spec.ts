/**
 * Zone privacy: a foreign conversation zone must not be audible (P72-a).
 *
 * Real paths only: two real browser clients over the isolated test stack,
 * the real LiveKit SFU (fixtures require LIVEKIT_URL/KEY/SECRET), real
 * PUT/GET zone state via /maps/:id/editor-state, and real avatar movement
 * via arrow keys through the Phaser scene (MainScene.ts:263 dispatches
 * keyboard cursors into playerManager.update, whose keyboard branch sets
 * velocity, playerManager.ts:165-181). No route mocks, no invented users
 * or tokens, no product test hooks.
 *
 * Measurement reuses the exported helpers of ./mediaFlow
 * (installMediaFlowObserver, readMediaFlowSnapshot, selectOutbound,
 * selectInbound, findBinding, inboundRemoteSids, readRemoteAudioMirrors,
 * attachMediaFlowSnapshot) and of ../fixtures/helpers (appRouteUrl,
 * waitForParticipant, getSeedTenant, passwordFor). The per-kind proof
 * chain (capture live track, ICE ready, outbound RTP, inbound mapping,
 * inbound RTP) mirrors apps/web/e2e/av/media-flow.spec.ts, whose local
 * functions are not exported, so the audio-only steps are rebuilt here in
 * minimal form (see the justification in the K21 result note).
 * Zone setup/restore mirrors apps/web/e2e/world/zones-sync.spec.ts
 * (get/put editor-state, baseline restore), which also exports nothing.
 *
 * Audio sender: the chromium fake-media stream is non-silent
 * (playwright.config.ts:31-38, audioNonSilent: true), so a live
 * outbound counter grows continuously once the microphone is on.
 * Silence is therefore measured against a previously proven growing
 * counter, and every silence assertion also proves the speaker's
 * outbound counter still grows during the same window: a muted or
 * broken sender cannot fake a pass.
 *
 * Run only against the isolated stack: E2E_RUN=true, MT_PROJECT=mtest-N
 * with the MT_PORT_API/MT_PORT_WEB ports (same guard as
 * zones-sync.spec.ts). Without E2E_RUN the file skips safely.
 * Playwright is NOT executed by the authoring task; the stack run
 * happens later.
 */

import { randomUUID } from 'node:crypto';

import { expect } from '@playwright/test';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';

import { test as zonePrivacyTest } from '../fixtures';
import type { RoomUsersFactory, TestStackEnv } from '../fixtures';
import { appRouteUrl, getSeedTenant, passwordFor, waitForParticipant } from '../fixtures/helpers';
import { MeetropolisApi } from '../support/api';
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

const SHOULD_RUN = process.env.E2E_RUN === 'true';

zonePrivacyTest.skip(!SHOULD_RUN, 'E2E_RUN=true is required: this spec only runs against the isolated test stack.');

/** Silence window: no inbound byte growth is accepted over this span. */
const SILENCE_WINDOW_MS = 5_000;

/**
 * Settle wait after a zone change before the silence window starts.
 * Covers the server hysteresis chain with wide margin: exit hysteresis
 * minMs 350 (membershipTracker.ts:48-53), hysteresis sweeper interval 200
 * (hysteresisSweeper.ts:23), allow-list push batch 100
 * (permissionOrchestrator.ts:37).
 */
const HYSTERESIS_SETTLE_MS = 5_000;

type ZonePoint = { x: number; y: number };

type BaselineZone = {
  name: string;
  capacity: number | null;
  polygon: ZonePoint[];
  type: string | null;
  portalTarget: string | null;
  portalSpawnX: number | null;
  portalSpawnY: number | null;
};

type Baseline = { zones: BaselineZone[]; backgroundColor: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asPoints(value: unknown): ZonePoint[] {
  if (!Array.isArray(value)) return [];
  const points: ZonePoint[] = [];
  for (const entry of value) {
    if (Array.isArray(entry) && typeof entry[0] === 'number' && typeof entry[1] === 'number') {
      points.push({ x: entry[0], y: entry[1] });
    } else if (isRecord(entry) && typeof entry.x === 'number' && typeof entry.y === 'number') {
      points.push({ x: entry.x, y: entry.y });
    }
  }
  return points;
}

function zonePoints(zone: Record<string, unknown>): ZonePoint[] {
  const direct = asPoints(zone.points ?? zone.polygon);
  if (direct.length > 0) return direct;
  return asPoints(isRecord(zone.polygon) ? zone.polygon.points : undefined);
}

/** Requires the isolated stack and rejects production targets outright. */
function requireIsolatedStack(stack: TestStackEnv): void {
  const project = process.env.MT_PROJECT ?? '';
  if (!/^mtest-\d+$/.test(project)) {
    throw new Error(`MT_PROJECT must be mtest-<number>, found: ${project || '<empty>'}.`);
  }
  const apiPort = process.env.MT_PORT_API ?? '';
  const webPort = process.env.MT_PORT_WEB ?? '';
  const targets: Array<[string, string, string]> = [
    ['E2E_API_URL', stack.apiUrl, apiPort],
    ['E2E_BASE_URL', stack.baseUrl, webPort],
  ];
  for (const [name, value, expectedPort] of targets) {
    if (expectedPort === '') throw new Error('Port mapping is missing: no expected port known.');
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} is not a valid URL.`);
    }
    if (url.protocol !== 'http:') throw new Error(`${name} must use loopback http.`);
    if (url.hostname !== 'localhost') throw new Error(`${name} must have origin localhost.`);
    if (url.port !== expectedPort) {
      throw new Error(`${name} port ${url.port} does not match the expected stack port.`);
    }
  }
}

async function getEditorState(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
): Promise<Record<string, unknown>> {
  const response = await request.get(`${apiUrl}/maps/${encodeURIComponent(mapId)}/editor-state?t=${Date.now()}`);
  if (!response.ok()) throw new Error(`GET editor-state failed: HTTP ${response.status()}.`);
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error('GET editor-state did not return a JSON object.');
  return body;
}

async function putEditorState(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  payload: unknown,
): Promise<void> {
  const response = await request.put(`${apiUrl}/maps/${encodeURIComponent(mapId)}/editor-state`, {
    data: payload,
  });
  if (!response.ok()) {
    throw new Error(`PUT editor-state failed: HTTP ${response.status()} ${await response.text()}.`);
  }
}

async function readBaseline(request: APIRequestContext, apiUrl: string, mapId: string): Promise<Baseline> {
  const state = await getEditorState(request, apiUrl, mapId);
  const zones = Array.isArray(state.zones) ? state.zones.filter(isRecord) : [];
  return {
    zones: zones.map((zone) => ({
      name: typeof zone.name === 'string' ? zone.name : 'Zone',
      capacity: typeof zone.capacity === 'number' ? zone.capacity : null,
      polygon: zonePoints(zone),
      type: typeof zone.type === 'string' ? zone.type : null,
      portalTarget: typeof zone.portalTarget === 'string' ? zone.portalTarget : null,
      portalSpawnX: typeof zone.portalSpawnX === 'number' ? zone.portalSpawnX : null,
      portalSpawnY: typeof zone.portalSpawnY === 'number' ? zone.portalSpawnY : null,
    })),
    backgroundColor: typeof state.backgroundColor === 'string' ? state.backgroundColor : null,
  };
}

/** Remembers zones and background of the seed map for restoration in finally. */
async function withBaseline(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  body: () => Promise<void>,
): Promise<void> {
  const baseline = await readBaseline(request, apiUrl, mapId);
  let bodyError: Error | null = null;
  try {
    await body();
  } catch (error) {
    bodyError = error instanceof Error ? error : new Error('test body failed without an error object.');
  }
  try {
    await putEditorState(request, apiUrl, mapId, {
      zones: baseline.zones,
      replaceZones: true,
      ...(baseline.backgroundColor ? { backgroundColor: baseline.backgroundColor } : {}),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (bodyError) throw new Error(`${bodyError.message} | Cleanup: restore failed: ${detail}`);
    throw new Error(`Cleanup failed: restore failed: ${detail}`);
  }
  if (bodyError) throw bodyError;
}

function readSpawn(state: Record<string, unknown>): ZonePoint {
  const spawn = state.spawn;
  if (!isRecord(spawn) || typeof spawn.x !== 'number' || typeof spawn.y !== 'number') {
    throw new Error('GET editor-state carries no numeric spawn; cannot place zones around spawn.');
  }
  return { x: spawn.x, y: spawn.y };
}

function rect(x0: number, y0: number, x1: number, y1: number): ZonePoint[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

// Measured capture capability for audio (M1 section 7 pattern from
// media-flow.spec.ts): only a measured false skips; unknown fails loudly.
function requireMeasuredAudio(testInfo: TestInfo): void {
  const metadata: unknown = testInfo.project.metadata;
  const capabilities =
    typeof metadata === 'object' && metadata !== null ? (metadata as Record<string, unknown>)['capabilities'] : null;
  const flag =
    typeof capabilities === 'object' && capabilities !== null
      ? (capabilities as Record<string, unknown>)['getUserMediaAudio']
      : null;
  if (flag === false) {
    zonePrivacyTest.skip(
      true,
      `[M1§7] project "${testInfo.project.name}" has no measurable audio capture; ` +
        'skip is a measurement boundary, not an AV pass.',
    );
    return;
  }
  if (flag !== true) {
    throw new Error(
      `setup measurement gap: project "${testInfo.project.name}" has no boolean ` +
        'metadata.capabilities.getUserMediaAudio; refusing to skip as measured-missing.',
    );
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type CapturedAudioTrack = { peer: string; trackId: string };

function dedupAudioTracks(bindings: MediaFlowBinding[]): CapturedAudioTrack[] {
  const unique = new Map<string, CapturedAudioTrack>();
  for (const binding of bindings) {
    if (binding.trackId === null) continue;
    const key = `${binding.peer}|${binding.trackId}|${binding.kind}`;
    if (!unique.has(key)) unique.set(key, { peer: binding.peer, trackId: binding.trackId });
  }
  return [...unique.values()];
}

// Live audio track of the tested kind: outbound sender when expectedSid is
// null, inbound receiver for that sid otherwise. Live handle only, never
// RTP rows; ambiguity fails loudly (same rule as media-flow.spec.ts).
function captureLiveAudioTrack(
  snapshot: MediaFlowSnapshot,
  role: string,
  expectedSid: string | null,
): CapturedAudioTrack {
  const where = expectedSid === null ? 'outbound audio sender' : 'inbound audio receiver';
  const matches = dedupAudioTracks(
    snapshot.peers
      .flatMap((peer) => peer.bindings)
      .filter(
        (binding) =>
          binding.kind === 'audio' &&
          binding.trackId !== null &&
          binding.readyState === 'live' &&
          (expectedSid === null
            ? binding.direction === 'outbound'
            : binding.direction === 'inbound' && binding.remoteSid === expectedSid),
      ),
  );
  if (matches.length === 0) throw new Error(`${role}: capture found no live ${where} track.`);
  const winner = matches[0];
  if (matches.length !== 1 || !winner) {
    throw new Error(`${role}: capture ambiguous with ${matches.length} live ${where} tracks.`);
  }
  return winner;
}

// Two-snapshot readiness: the first read sets the basis, byte growth picks
// the key (same rule as media-flow.spec.ts: same native counter, growth
// between two consecutive snapshots).
async function awaitAudioStatsKey(
  page: Page,
  role: string,
  capture: CapturedAudioTrack,
  sid: string | null,
): Promise<string> {
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
              ? selectOutbound(basis, current, 'audio', capture)
              : selectInbound(basis, current, 'audio', capture, sid);
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
      throw new Error(`${role}: ${direction} audio stats readiness failed: ${errorText(lastError ?? error)}`);
    });
  if (!key) throw new Error(`${role}: ${direction} audio stats never produced a native RTP row.`);
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

// Positive proof: the same native counter is above zero, then grows.
async function proveAudioFlow(
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
  await attachMediaFlowSnapshot(testInfo, `zone-privacy-${phase}-${role}`, { role, phase, snapshot });
}

// Expects: no new inbound audio bytes from `sid` over the silence window.
// Two acceptable server states: the inbound binding is gone (track
// removed after the SFU allow-list narrowed), or its counter stands
// still. Any growth fails. The speaker's own outbound counter must grow
// during the same window, otherwise a muted sender would fake a pass.
async function expectAudioSilence(
  listener: Page,
  speaker: Page,
  role: string,
  sid: string | null,
  speakerOutboundKey: string,
  testInfo: TestInfo,
  phase: string,
): Promise<void> {
  const speakerRead = byteReader(speaker, speakerOutboundKey, 'outbound');
  const speakerBefore = await speakerRead();
  let before: number | null = null;
  let bindingGone = false;
  try {
    const snapshot = await readMediaFlowSnapshot(listener);
    const rows =
      sid === null
        ? []
        : snapshot.peers
            .flatMap((peer) => peer.bindings)
            .filter(
              (binding) =>
                binding.direction === 'inbound' &&
                binding.kind === 'audio' &&
                binding.remoteSid === sid &&
                binding.statsError === null &&
                binding.bytesReceived !== null,
            );
    if (rows.length === 0) {
      bindingGone = true;
    } else {
      const row = rows[0];
      if (!row || row.bytesReceived === null) throw new Error(`${role}: inbound audio row unreadable.`);
      before = row.bytesReceived;
    }
  } catch (error) {
    throw new Error(`${role}: silence baseline unreadable: ${errorText(error)}`);
  }
  await listener.waitForTimeout(SILENCE_WINDOW_MS);
  const speakerAfter = await speakerRead();
  if (!(speakerAfter > speakerBefore && speakerBefore > 0)) {
    throw new Error(
      `${role}: speaker outbound did not grow during the silence window ` +
        `(${speakerBefore} -> ${speakerAfter}); silence proves nothing with a muted sender.`,
    );
  }
  if (bindingGone) {
    await attachFlow(testInfo, `${phase}-silence-binding-gone`, role, listener);
    return;
  }
  const snapshot = await readMediaFlowSnapshot(listener);
  const rows = snapshot.peers
    .flatMap((peer) => peer.bindings)
    .filter(
      (binding) =>
        binding.direction === 'inbound' &&
        binding.kind === 'audio' &&
        binding.remoteSid === sid &&
        binding.statsError === null &&
        binding.bytesReceived !== null,
    );
  if (rows.length === 0) {
    await attachFlow(testInfo, `${phase}-silence-binding-gone`, role, listener);
    return;
  }
  const row = rows[0];
  if (!row || row.bytesReceived === null || before === null) {
    throw new Error(`${role}: inbound audio row unreadable after the silence window.`);
  }
  if (row.bytesReceived !== before) {
    throw new Error(
      `${role}: inbound audio bytes grew during the silence window ` +
        `(${before} -> ${row.bytesReceived}); foreign zone is audible.`,
    );
  }
  await attachFlow(testInfo, `${phase}-silence-confirmed`, role, listener);
}

// Switches the microphone on via the real product toggle (same selectors
// as media-flow.spec.ts). Only the off state is clicked.
async function ensureMicOn(page: Page, role: string): Promise<void> {
  const micOff = page.getByTitle(/^mikrofon einschalten/i).or(page.getByTitle(/^unmute microphone/i));
  const micOn = page.getByTitle(/^mikrofon ausschalten/i).or(page.getByTitle(/^mute microphone/i));
  const micToggle = micOff.or(micOn);
  await expect(micToggle, `${role}: microphone toggle never became visible`).toBeVisible({ timeout: 30_000 });
  await expect(micToggle, `${role}: microphone toggle is not unique`).toHaveCount(1);
  if ((await micOff.count()) > 0) await micOff.click();
  await expect(micOn, `${role}: microphone did not switch on`).toBeVisible({ timeout: 30_000 });
}

// Real avatar movement: holds an arrow key, which the Phaser scene turns
// into velocity (playerManager speed 80 px/s, playerManager.ts:122) and
// the client reports as move messages; the server recomputes the island
// on every accepted move (playerHandlers.ts:43-44, runtime.ts:93-106).
async function moveAvatar(
  page: Page,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  ms: number,
): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/**
 * Walk time for the spawn-to-Y leg. At 80 px/s (playerManager.ts:122)
 * 25 s cover about 2000 px: from spawn (x+0) to the middle of zone Y
 * (x+1800). Zone Y spans x+800..x+2800, so arrivals between 18 s and
 * 35 s still land inside; the exact speed is calibrated at the stack
 * run. Fail-closed: arriving late keeps bytes flowing and fails red.
 */
const SPAWN_TO_Y_HOLD_MS = 25_000;

async function awaitLiveAudioTrack(page: Page, role: string, sid: string | null): Promise<CapturedAudioTrack> {
  let capture: CapturedAudioTrack | null = null;
  await expect
    .poll(
      async () => {
        try {
          const snapshot = await readMediaFlowSnapshot(page);
          capture = captureLiveAudioTrack(snapshot, role, sid);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 15_000, intervals: [500] },
    )
    .toBe(true);
  if (!capture) throw new Error(`${role}: capture found no live audio track.`);
  return capture;
}

// Exactly one remote audio participant per page; more than one is
// ambiguity or an unexpected third party and fails the mapping.
async function awaitRemoteAudioSid(page: Page, role: string): Promise<string> {
  await expect
    .poll(
      async (): Promise<MediaFlowSnapshot | null> => {
        try {
          const current = await readMediaFlowSnapshot(page);
          return inboundRemoteSids(current, 'audio').length > 0 ? current : null;
        } catch {
          return null;
        }
      },
      { timeout: 15_000, intervals: [500] },
    )
    .not.toBeNull();
  const current = await readMediaFlowSnapshot(page);
  const sids = inboundRemoteSids(current, 'audio');
  if (sids.length !== 1 || !sids[0]) {
    throw new Error(`${role}: expected exactly one remote audio participant, saw ${sids.length}.`);
  }
  return sids[0];
}

type AudiblePair = {
  ownerPage: Page;
  memberPage: Page;
  ownerSees: string;
  memberSees: string;
  ownerOutKey: string;
  memberOutKey: string;
  ownerInKey: string;
  memberInKey: string;
};

// Joins two clients and proves audio flows both ways (control state).
// Every separation test starts from this proven-audible state, so a
// later silence cannot be blamed on a broken microphone or sender.
async function joinTwoAudibleClients(
  roomUsers: RoomUsersFactory,
  stack: TestStackEnv,
  testInfo: TestInfo,
): Promise<AudiblePair> {
  const participants = await roomUsers(2, { tenant: 'seed', join: false });
  const [owner, member] = participants;
  if (!owner || !member || participants.length !== 2) {
    throw new Error('roomUsers did not create exactly two participants.');
  }
  const ownerPage = owner.page;
  const memberPage = member.page;

  // Observer before app navigation so the native constructor is wrapped first.
  await ownerPage.addInitScript(installMediaFlowObserver);
  await memberPage.addInitScript(installMediaFlowObserver);

  await ownerPage.goto(appRouteUrl(stack.baseUrl, 'app'));
  await memberPage.goto(appRouteUrl(stack.baseUrl, 'app'));

  await waitForParticipant(ownerPage, member.user);
  await waitForParticipant(memberPage, owner.user);

  await readMediaFlowSnapshot(ownerPage);
  await readMediaFlowSnapshot(memberPage);

  await ensureMicOn(ownerPage, 'owner');
  await ensureMicOn(memberPage, 'member');

  const ownerCapture = await awaitLiveAudioTrack(ownerPage, 'owner', null);
  const memberCapture = await awaitLiveAudioTrack(memberPage, 'member', null);
  const ownerOutKey = await awaitAudioStatsKey(ownerPage, 'owner', ownerCapture, null);
  const memberOutKey = await awaitAudioStatsKey(memberPage, 'member', memberCapture, null);
  await proveAudioFlow(ownerPage, 'owner', 'outbound audio', ownerOutKey, 'outbound');
  await proveAudioFlow(memberPage, 'member', 'outbound audio', memberOutKey, 'outbound');
  await attachFlow(testInfo, 'control-outbound', 'owner', ownerPage);
  await attachFlow(testInfo, 'control-outbound', 'member', memberPage);

  const ownerSees = await awaitRemoteAudioSid(ownerPage, 'owner');
  const memberSees = await awaitRemoteAudioSid(memberPage, 'member');
  if (ownerSees === memberSees) throw new Error('both pages observe the same remote sid; mapping ambiguous.');

  const ownerInbound = await awaitLiveAudioTrack(ownerPage, 'owner', ownerSees);
  const memberInbound = await awaitLiveAudioTrack(memberPage, 'member', memberSees);
  const ownerInKey = await awaitAudioStatsKey(ownerPage, 'owner', ownerInbound, ownerSees);
  const memberInKey = await awaitAudioStatsKey(memberPage, 'member', memberInbound, memberSees);
  await proveAudioFlow(ownerPage, 'owner', 'inbound audio', ownerInKey, 'inbound');
  await proveAudioFlow(memberPage, 'member', 'inbound audio', memberInKey, 'inbound');
  await attachFlow(testInfo, 'control-inbound', 'owner', ownerPage);
  await attachFlow(testInfo, 'control-inbound', 'member', memberPage);

  return { ownerPage, memberPage, ownerSees, memberSees, ownerOutKey, memberOutKey, ownerInKey, memberInKey };
}

function uniqueZoneName(tag: string): string {
  return `zp-${tag}-${randomUUID().slice(0, 8)}`;
}

// Expects: two participants in the same zone hear each other, i.e.
// audio bytes flow both ways. This is the control case: it proves the
// sender chain, the SFU path, and the measurement itself work before
// any separation test relies on silence.
zonePrivacyTest(
  'same zone: two participants hear each other',
  async ({ roomUsers, stack, seed, request }, testInfo) => {
    zonePrivacyTest.setTimeout(180_000);
    requireMeasuredAudio(testInfo);
    requireIsolatedStack(stack);
    const tenant = getSeedTenant(seed);
    if (!tenant.mapId) throw new Error('seed tenant has no mapId.');
    const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenant.slug);
    const seedOwner = tenant.users.owner;
    if (!seedOwner?.password) throw new Error('seed provides no owner with a password.');
    await ownerApi.login(seedOwner.email, passwordFor(seedOwner));

    await withBaseline(request, stack.apiUrl, tenant.mapId, async () => {
      const spawn = readSpawn(await getEditorState(request, stack.apiUrl, tenant.mapId));
      const zoneX = uniqueZoneName('x');
      await putEditorState(request, stack.apiUrl, tenant.mapId, {
        zones: [{ name: zoneX, points: rect(spawn.x - 5000, spawn.y - 5000, spawn.x + 5000, spawn.y + 5000) }],
        replaceZones: true,
      });

      const pair = await joinTwoAudibleClients(roomUsers, stack, testInfo);

      // Audio DOM mirror: native srcObject ids must contain the receiver id.
      for (const [page, role, sid, inKey] of [
        [pair.ownerPage, 'owner', pair.ownerSees, pair.ownerInKey],
        [pair.memberPage, 'member', pair.memberSees, pair.memberInKey],
      ] as Array<[Page, string, string, string]>) {
        const mirrors = await readRemoteAudioMirrors(page);
        const match = mirrors.find((mirror) => mirror.participantSid === sid);
        if (!match) throw new Error(`${role}: no audio mirror for the observed remote participant.`);
        const binding = findBinding(await readMediaFlowSnapshot(page), inKey);
        if (!binding || !binding.trackId) throw new Error(`${role}: inbound audio binding lost its track.`);
        if (!match.trackIds.includes(binding.trackId)) {
          throw new Error(`${role}: audio mirror ids do not contain the inbound receiver track id.`);
        }
      }
      await attachFlow(testInfo, 'same-zone-mirrors', 'owner', pair.ownerPage);
      await attachFlow(testInfo, 'same-zone-mirrors', 'member', pair.memberPage);
    });
  },
);

// Expects: with A in zone X and B in zone Y (disjoint, both around the
// spawn), B receives no new audio bytes from A, and A receives none
// from B. Starts from proven audibility in X, so silence is caused by
// the separation, not by a broken sender.
zonePrivacyTest(
  'different zones: participants do not hear each other',
  async ({ roomUsers, stack, seed, request }, testInfo) => {
    zonePrivacyTest.setTimeout(180_000);
    requireMeasuredAudio(testInfo);
    requireIsolatedStack(stack);
    const tenant = getSeedTenant(seed);
    if (!tenant.mapId) throw new Error('seed tenant has no mapId.');
    const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenant.slug);
    const seedOwner = tenant.users.owner;
    if (!seedOwner?.password) throw new Error('seed provides no owner with a password.');
    await ownerApi.login(seedOwner.email, passwordFor(seedOwner));

    await withBaseline(request, stack.apiUrl, tenant.mapId, async () => {
      const spawn = readSpawn(await getEditorState(request, stack.apiUrl, tenant.mapId));
      const zoneX = uniqueZoneName('x');
      const zoneY = uniqueZoneName('y');
      await putEditorState(request, stack.apiUrl, tenant.mapId, {
        zones: [
          { name: zoneX, points: rect(spawn.x - 2000, spawn.y - 1500, spawn.x + 400, spawn.y + 1500) },
          { name: zoneY, points: rect(spawn.x + 800, spawn.y - 1500, spawn.x + 2800, spawn.y + 1500) },
        ],
        replaceZones: true,
      });

      const pair = await joinTwoAudibleClients(roomUsers, stack, testInfo);

      await moveAvatar(pair.memberPage, 'ArrowRight', SPAWN_TO_Y_HOLD_MS);
      await pair.memberPage.waitForTimeout(HYSTERESIS_SETTLE_MS);

      await expectAudioSilence(
        pair.memberPage,
        pair.ownerPage,
        'member',
        pair.memberSees,
        pair.ownerOutKey,
        testInfo,
        'different-zones',
      );
      await expectAudioSilence(
        pair.ownerPage,
        pair.memberPage,
        'owner',
        pair.ownerSees,
        pair.memberOutKey,
        testInfo,
        'different-zones',
      );
    });
  },
);

// Expects: after A leaves shared zone X for zone Y, B (staying in X)
// receives no new audio bytes from A once the hysteresis window has
// passed, and vice versa. The departure closes the old island
// immediately while the destination opens only after hysteresis
// (membershipTracker.ts:106-133, defaults minSamples 3 / minMs 350 in
// membershipTracker.ts:48-53); HYSTERESIS_SETTLE_MS covers that chain
// plus the sweeper (hysteresisSweeper.ts:23) and the push batch
// (permissionOrchestrator.ts:37) with wide margin.
zonePrivacyTest(
  'leaving a zone stops audio to the former zone',
  async ({ roomUsers, stack, seed, request }, testInfo) => {
    zonePrivacyTest.setTimeout(180_000);
    requireMeasuredAudio(testInfo);
    requireIsolatedStack(stack);
    const tenant = getSeedTenant(seed);
    if (!tenant.mapId) throw new Error('seed tenant has no mapId.');
    const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenant.slug);
    const seedOwner = tenant.users.owner;
    if (!seedOwner?.password) throw new Error('seed provides no owner with a password.');
    await ownerApi.login(seedOwner.email, passwordFor(seedOwner));

    await withBaseline(request, stack.apiUrl, tenant.mapId, async () => {
      const spawn = readSpawn(await getEditorState(request, stack.apiUrl, tenant.mapId));
      const zoneX = uniqueZoneName('x');
      const zoneY = uniqueZoneName('y');
      await putEditorState(request, stack.apiUrl, tenant.mapId, {
        zones: [
          { name: zoneX, points: rect(spawn.x - 2000, spawn.y - 1500, spawn.x + 400, spawn.y + 1500) },
          { name: zoneY, points: rect(spawn.x + 800, spawn.y - 1500, spawn.x + 2800, spawn.y + 1500) },
        ],
        replaceZones: true,
      });

      const pair = await joinTwoAudibleClients(roomUsers, stack, testInfo);

      await moveAvatar(pair.ownerPage, 'ArrowRight', SPAWN_TO_Y_HOLD_MS);
      await pair.ownerPage.waitForTimeout(HYSTERESIS_SETTLE_MS);

      await expectAudioSilence(
        pair.memberPage,
        pair.ownerPage,
        'member',
        pair.memberSees,
        pair.ownerOutKey,
        testInfo,
        'leaving-zone',
      );
      await expectAudioSilence(
        pair.ownerPage,
        pair.memberPage,
        'owner',
        pair.ownerSees,
        pair.memberOutKey,
        testInfo,
        'leaving-zone',
      );
    });
  },
);

// Expects: an explicit cross-zone subscription request from the page
// context (the "DevTools attack" from the finding) yields no audio
// bytes. OPEN: the LiveKit Room object is not reachable from the page
// context through any documented product path. The only write path to
// setTrackSubscriptionPermissions lives in ZonePermissionsManager
// (zonePermissionsManager.ts:52-63) via injected deps, never on
// window; window carries only the AV logger and debug flags
// (AVLogger.ts:191-202) plus the test-only media-flow observer keys.
// No product test hook is added to work around this (per the task).
// The stack run first records which window keys exist (names only, no
// values or secrets); if a Room handle is reachable after all, the
// explicit subscribe attempt and its byte measurement are added here.
zonePrivacyTest('subscription request across zones is refused by the SFU', async ({ roomUsers, stack }, testInfo) => {
  zonePrivacyTest.setTimeout(180_000);
  requireMeasuredAudio(testInfo);
  requireIsolatedStack(stack);

  const participants = await roomUsers(1, { tenant: 'seed', join: false });
  const [only] = participants;
  if (!only) throw new Error('roomUsers did not create a participant.');
  await only.page.addInitScript(installMediaFlowObserver);
  await only.page.goto(appRouteUrl(stack.baseUrl, 'app'));
  await readMediaFlowSnapshot(only.page);
  const windowKeys: unknown = await only.page.evaluate(() =>
    Object.keys(window).filter((key) => /room|livekit|colyseus|participant|subscription/i.test(key)),
  );
  await testInfo.attach('zone-privacy-room-handle-probe', {
    body: JSON.stringify({ windowKeys }, null, 2),
    contentType: 'application/json',
  });
  zonePrivacyTest.skip(
    true,
    'open: no reachable LiveKit Room handle in the page context was established ' +
      '(see zonePermissionsManager.ts:52-63, AVLogger.ts:191-202); ' +
      'explicit cross-zone subscribe cannot be attempted without a product test hook, ' +
      'which is out of scope. Probe artifact zone-privacy-room-handle-probe names the finding.',
  );
});
