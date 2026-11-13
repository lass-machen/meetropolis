import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { Room } from '@livekit/rtc-node';
import type { PrismaClient } from '../generated/prisma/index.js';
import { mapLivekitUrlToHttp } from '../rooms/audioZones/livekitAdmin.js';
import { stopAvPendingRevocations } from '../rooms/lifecycle/avPendingRevocations.js';
import { startAvAccessReconciler } from '../rooms/lifecycle/avAccessReconciler.js';

/**
 * LiveKit (SFU) harness for database-backed integration tests: real
 * participants through `@livekit/rtc-node`, real admin calls through
 * `livekit-server-sdk`, real outages through `docker pause`. Mirrors the
 * docker pattern of the world access outage test. Nothing here is mocked.
 */

export interface SfuConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

export interface AvReconciler {
  runRound(): Promise<void>;
  stop(): Promise<void>;
}

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 250;

const connectedRooms: Room[] = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read the SFU coordinates from the environment; fail fast when any is missing. */
export function sfuConfig(): SfuConfig {
  const url = process.env.LIVEKIT_URL;
  if (!url) throw new Error('sfuHarness needs LIVEKIT_URL pointing at the test SFU');
  const apiKey = process.env.LIVEKIT_API_KEY;
  if (!apiKey) throw new Error('sfuHarness needs LIVEKIT_API_KEY for the test SFU');
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiSecret) throw new Error('sfuHarness needs LIVEKIT_API_SECRET for the test SFU');
  return { url, apiKey, apiSecret };
}

/** Name of the container running the test SFU; fail fast when it is missing. */
function sfuContainer(): string {
  const container = process.env.TEST_SFU_CONTAINER;
  if (!container) throw new Error('sfuHarness needs TEST_SFU_CONTAINER naming the test SFU container');
  return container;
}

function adminClient(): RoomServiceClient {
  const { url, apiKey, apiSecret } = sfuConfig();
  return new RoomServiceClient(mapLivekitUrlToHttp(url), apiKey, apiSecret);
}

/** Connect a real participant with `token`; tracked for {@link disconnectAll}. */
export async function connectParticipant(token: string): Promise<Room> {
  const { url } = sfuConfig();
  const room = new Room();
  await room.connect(url, token, { autoSubscribe: false });
  connectedRooms.push(room);
  return room;
}

/** Leave every room opened through {@link connectParticipant}; never throws. */
export async function disconnectAll(): Promise<void> {
  const rooms = connectedRooms.splice(0);
  for (const room of rooms) {
    try {
      await room.disconnect();
    } catch {
      // Already gone; cleanup must not fail the test.
    }
  }
}

/**
 * Mint a service-side token for `identity` in `roomName`. Only for
 * service-owned and legacy cases in tests (NPC publishers, user tokens
 * without a session reference, unknown `npc-` identities).
 */
export async function mintServiceToken(
  roomName: string,
  identity: string,
  opts?: { metadata?: string },
): Promise<string> {
  const { apiKey, apiSecret } = sfuConfig();
  const token = new AccessToken(
    apiKey,
    apiSecret,
    { identity, ...(opts?.metadata !== undefined ? { metadata: opts.metadata } : {}) },
  );
  token.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
  return token.toJwt();
}

/** Identities currently present in the SFU-side `roomName`. */
export async function listIdentities(roomName: string): Promise<string[]> {
  return (await adminClient().listParticipants(roomName)).map((participant) => participant.identity);
}

async function pollIdentity(roomName: string, identity: string, timeoutMs: number, present: boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await listIdentities(roomName)).includes(identity) === present) return true;
    if (Date.now() > deadline) return false;
    await delay(POLL_INTERVAL_MS);
  }
}

/**
 * Poll until `identity` is gone from `roomName` (every 250 ms). Returns
 * whether the condition held in time, so tests can assert on the result.
 */
export async function waitForIdentityGone(roomName: string, identity: string, timeoutMs: number): Promise<boolean> {
  return pollIdentity(roomName, identity, timeoutMs, false);
}

/**
 * Poll until `identity` is present in `roomName` (every 250 ms). Returns
 * whether the condition held in time, so tests can assert on the result.
 */
export async function waitForIdentityPresent(
  roomName: string,
  identity: string,
  timeoutMs: number,
): Promise<boolean> {
  return pollIdentity(roomName, identity, timeoutMs, true);
}

async function setSfuPaused(action: 'pause' | 'unpause'): Promise<void> {
  const container = sfuContainer();
  try {
    await execFileAsync('docker', [action, container]);
  } catch (e: unknown) {
    throw new Error(
      `sfuHarness needs docker access to ${action} ${container}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Pause the test SFU container. Pair with {@link unpauseSfu} in a `finally`. */
export async function pauseSfu(): Promise<void> {
  await setSfuPaused('pause');
}

/** Unpause the test SFU container. */
export async function unpauseSfu(): Promise<void> {
  await setSfuPaused('unpause');
}

/** Run `fn` with the SFU paused; the container is always unpaused afterwards. */
export async function withSfuPaused<T>(fn: () => Promise<T>): Promise<T> {
  await pauseSfu();
  try {
    return await fn();
  } finally {
    await unpauseSfu();
  }
}

/**
 * Start the AV reconciliation loop under test: the real reconciler with a
 * 30 s interval (rounds run only through `runRound` here) and the
 * process-wide confirmed-removal backlog. `stop` ends both. No other helper
 * in this file changes with that fix.
 */
export async function startAvReconcile(prisma: PrismaClient): Promise<AvReconciler> {
  const reconciler = startAvAccessReconciler(prisma);
  let stopped = false;
  return {
    runRound: () => reconciler.runRound(),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await reconciler.stop();
      await stopAvPendingRevocations();
    },
  };
}
