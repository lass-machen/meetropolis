/**
 * Two real Colyseus processes share one world room through Redis.
 *
 * Matchmaking, map-update presence and access revocation cross the
 * process boundary. The workers are child processes (`fork` + tsx);
 * Redis and PostgreSQL are the real services behind REDIS_TEST_URL
 * and DATABASE_URL. Setup follows the tenant world-access fixture:
 * one tenant, two members, JWT plus session row, one global avatar pack.
 */
import { fork, type ChildProcess } from 'node:child_process';
import crypto from 'crypto';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import type { Role } from '../generated/prisma/index.js';
import { createPrismaClient } from '../db.js';
import { getJwtSecret } from '../api/utils/authHelpers.js';
import { hashSessionToken } from '../api/utils/sessionAuth.js';

if (!process.env.DATABASE_URL) {
  throw new Error('multiprocess.redis.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const WORKER_FILE = fileURLToPath(new URL('../testUtils/multiprocessWorker.ts', import.meta.url));
const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
const packUuids: string[] = [];
let fixturePackUuid = '';
let tenantId = '';
let tenantSlug = '';
let userA: { id: string; token: string } | undefined;
let userB: { id: string; token: string } | undefined;
let worker1: ChildProcess | undefined;
let worker2: ChildProcess | undefined;
let port1 = 0;
let port2 = 0;
let roomA: Room | undefined;
let roomB: Room | undefined;

interface WorkerMessage {
  type?: unknown;
  port?: unknown;
  roomIds?: unknown;
  message?: unknown;
}

async function seedGlobalAvatarPack(): Promise<void> {
  const uuid = `mpr-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await prisma.avatarPack.create({
    data: {
      uuid,
      name: uuid,
      description: 'multiprocess join fixture',
      author: 'mpr-fixture',
      version: '1',
      avatars: [{ key: 'business_man' }],
      tenantId: null,
    },
  });
  packUuids.push(uuid);
  fixturePackUuid = uuid;
}

async function createUser(
  memberships: Array<{ tenantId: string; role: Role }>,
  sessionTenantId: string,
): Promise<{ id: string; token: string }> {
  const user = await prisma.user.create({
    data: {
      email: `mpr-${crypto.randomUUID()}@example.test`,
      avatarId: `${fixturePackUuid}:business_man`,
    },
  });
  userIds.push(user.id);
  for (const membership of memberships) {
    await prisma.membership.create({ data: { userId: user.id, ...membership } });
  }
  const token = jwt.sign({ sub: user.id, tid: sessionTenantId, jti: crypto.randomUUID() }, getJwtSecret(), {
    expiresIn: '1h',
  });
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { id: user.id, token };
}

function joinOptions(tenant: string): Record<string, unknown> {
  return {
    tenant,
    avatarId: `${fixturePackUuid}:business_man`,
    zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
  };
}

async function reserveLoopbackPorts(count: number): Promise<number[]> {
  const servers: net.Server[] = [];
  const ports: number[] = [];
  try {
    for (let index = 0; index < count; index++) {
      const server = net.createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
      });
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('failed to reserve a loopback port');
      }
      ports.push(address.port);
      servers.push(server);
    }
  } finally {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  }
  return ports;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as Record<string, unknown>;
}

function waitForMessage(child: ChildProcess, type: string, timeoutMs: number): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('message', onMessage);
      reject(new Error(`timed out waiting for ${type}`));
    }, timeoutMs);
    function onMessage(raw: unknown): void {
      const record = asRecord(raw);
      if (!record) return;
      if (record.type === 'error') {
        clearTimeout(timer);
        child.off('message', onMessage);
        reject(new Error(typeof record.message === 'string' ? record.message : 'worker error'));
        return;
      }
      if (record.type !== type) return;
      clearTimeout(timer);
      child.off('message', onMessage);
      resolve(record);
    }
    child.on('message', onMessage);
  });
}

async function startWorker(port: number): Promise<ChildProcess> {
  const redisUrl = process.env.REDIS_TEST_URL;
  const databaseUrl = process.env.DATABASE_URL;
  if (!redisUrl || !databaseUrl) throw new Error('REDIS_TEST_URL and DATABASE_URL are required');
  const child = fork(WORKER_FILE, {
    execArgv: ['--import', 'tsx'],
    env: {
      ...process.env,
      PORT: String(port),
      REDIS_URL: redisUrl,
      DATABASE_URL: databaseUrl,
      JWT_SECRET: getJwtSecret(),
    },
  });
  await waitForMessage(child, 'ready', 30_000);
  return child;
}

async function sendCommand(
  child: ChildProcess,
  command: object,
  type: string,
  timeoutMs = 5_000,
): Promise<WorkerMessage> {
  const pending = waitForMessage(child, type, timeoutMs);
  child.send(command);
  return pending;
}

function stopWorker(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      if (child.pid !== undefined) process.kill(child.pid);
      resolve();
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.send({ cmd: 'stop' });
  });
}

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`${label} not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function playerCount(room: Room): number {
  return [...room.state.players.values()].length;
}

function ownMapId(room: Room): string | undefined {
  const player = room.state.players.get(room.sessionId) as { mapId?: unknown } | undefined;
  return typeof player?.mapId === 'string' ? player.mapId : undefined;
}

function collectMessages(room: Room, type: string): unknown[] {
  const received: unknown[] = [];
  room.onMessage(type, (payload: unknown) => {
    received.push(payload);
  });
  return received;
}

async function leaveQuietly(room: Room | undefined): Promise<void> {
  if (!room) return;
  await Promise.race([room.leave().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 3_000))]);
}

function roomIdsOf(message: WorkerMessage): string[] {
  return Array.isArray(message.roomIds) ? message.roomIds.filter((id): id is string => typeof id === 'string') : [];
}

describe.skipIf(!process.env.REDIS_TEST_URL)('two Colyseus processes share a world room over Redis', () => {
  beforeAll(async () => {
    tenantSlug = `mpr-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const tenant = await prisma.tenant.create({ data: { slug: tenantSlug, name: tenantSlug } });
    tenantId = tenant.id;
    tenantIds.push(tenant.id);
    await seedGlobalAvatarPack();
    userA = await createUser([{ tenantId, role: 'member' }], tenantId);
    userB = await createUser([{ tenantId, role: 'member' }], tenantId);
    const ports = await reserveLoopbackPorts(2);
    port1 = ports[0] ?? 0;
    port2 = ports[1] ?? 0;
    worker1 = await startWorker(port1);
    worker2 = await startWorker(port2);
  }, 60_000);

  afterAll(async () => {
    await leaveQuietly(roomA);
    await leaveQuietly(roomB);
    if (worker1) await stopWorker(worker1);
    if (worker2) await stopWorker(worker2);
    await prisma.avatarPack.deleteMany({ where: { uuid: { in: packUuids } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await prisma.$disconnect();
  }, 60_000);

  it('joins the same room, forwards a map update, and revokes from the other process', async () => {
    if (!userA || !userB || !worker1 || !worker2) throw new Error('fixture missing');
    const clientA = new Client(`http://127.0.0.1:${port1}`);
    const clientB = new Client(`http://127.0.0.1:${port2}`);
    clientA.auth.token = userA.token;
    clientB.auth.token = userB.token;
    let leftA = false;
    let leftB = false;
    roomA = await clientA.joinOrCreate('world', joinOptions(tenantSlug));
    roomB = await clientB.joinOrCreate('world', joinOptions(tenantSlug));
    const joinedA = roomA;
    const joinedB = roomB;
    joinedA.onLeave(() => {
      leftA = true;
    });
    joinedB.onLeave(() => {
      leftB = true;
    });
    expect(joinedA.roomId).toBe(joinedB.roomId);
    await waitFor(() => playerCount(joinedA) >= 2 && playerCount(joinedB) >= 2, 10_000, 'two players in state');

    const rooms1 = roomIdsOf(await sendCommand(worker1, { cmd: 'localRooms' }, 'localRooms'));
    const rooms2 = roomIdsOf(await sendCommand(worker2, { cmd: 'localRooms' }, 'localRooms'));
    const roomId = joinedA.roomId;
    const firstHolds = rooms1.includes(roomId);
    const secondHolds = rooms2.includes(roomId);
    expect(firstHolds !== secondHolds, 'exactly one worker hosts the room').toBe(true);
    const other = firstHolds ? worker2 : worker1;

    const mapId = ownMapId(joinedA);
    expect(mapId, 'joined player has a map id').toBeTruthy();
    const marker = crypto.randomUUID();
    const updatesA = collectMessages(joinedA, 'objects_updated');
    const updatesB = collectMessages(joinedB, 'objects_updated');
    await sendCommand(other, { cmd: 'mapUpdate', tenant: tenantSlug, payload: { mapId, marker } }, 'done');
    await waitFor(() => updatesA.length > 0 && updatesB.length > 0, 5_000, 'objects_updated on both clients');

    await prisma.membership.deleteMany({ where: { userId: userB.id } });
    await sendCommand(other, { cmd: 'revoke', userId: userB.id }, 'done');
    await waitFor(() => leftB, 5_000, 'revoked client left');
    expect(leftA, 'the other member stays connected').toBe(false);
  }, 60_000);
});
