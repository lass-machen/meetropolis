/**
 * Editor updates only reach clients that share the sender map with a current owner or admin role.
 *
 * A real Colyseus server with the real WorldRoom (see
 * testUtils/matchmakeHarness.ts), a real PostgreSQL database (db.js is NOT
 * mocked) and real @colyseus/sdk clients. Two maps of one tenant separate the
 * recipients: every join starts on the `office` map, and one recipient moves
 * to the `studio` map through the real `change_map` handler. Seeds come from
 * testUtils/worldSeed.ts, roles change through the real membership row.
 *
 * A sender never receives its own broadcast, so every case pairs the sender
 * with one or two receiving clients. Message shapes match the web client:
 * `{ type: 'reload_all' }` after saving, `{ type: 'zone', polys: [...] }`
 * after moving through the world.
 *
 * Three cases fail on the unfixed basis: a member sender reaches the room, a
 * foreign mapId steers the broadcast onto the named map, and a sender demoted
 * after joining keeps reaching the room. The two owner/admin controls hold
 * with and without the fix.
 */

import crypto from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import { createPrismaClient } from '../../db.js';
import { cleanupTenants, seedMember, seedTenant } from '../../testUtils/worldSeed.js';
import {
  disposeAllRooms,
  startMatchmakeServer,
  stopMatchmakeServer,
  type MatchmakeTestServer,
} from '../../testUtils/matchmakeHarness.js';

if (!process.env.DATABASE_URL) {
  throw new Error('editorAuthorization.integration.test.ts needs DATABASE_URL for a migrated test database');
}

const prisma = createPrismaClient();
const packUuids: string[] = [];
const openRooms: Room[] = [];
let server: MatchmakeTestServer;
let tenantId = '';
let tenantSlug = '';
let fixturePackUuid = '';
let officeId = '';
let studioId = '';

/** A zone payload shaped like the web client sends after moving through the world. */
const ZONE_POLYS = [
  {
    name: 'hall',
    points: [
      { x: 10, y: 10 },
      { x: 60, y: 10 },
      { x: 60, y: 60 },
    ],
  },
];

/**
 * One global (tenantId null) avatar pack so a join that passes the gate can
 * run to completion. Real fixture row, not a mock: without any pack in scope
 * even a fully authorized join is refused later in onJoin.
 */
async function seedGlobalAvatarPack(): Promise<void> {
  const uuid = `edauth-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await prisma.avatarPack.create({
    data: {
      uuid,
      name: uuid,
      description: 'editor authorization join fixture',
      author: 'edauth-fixture',
      version: '1',
      avatars: [{ key: 'business_man' }],
      tenantId: null,
    },
  });
  packUuids.push(uuid);
  fixturePackUuid = uuid;
}

function joinOptions(): Record<string, unknown> {
  return {
    tenant: tenantSlug,
    // A real client always names its avatar; without one even an authorized
    // join stops later in onJoin, which would blur the editor signal.
    avatarId: `${fixturePackUuid}:business_man`,
    zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
  };
}

async function joinWorld(identity: string, token: string): Promise<{ room?: Room; error?: unknown }> {
  const client = new Client(server.base);
  client.auth.token = token;
  try {
    const room = await client.joinOrCreate('world', { ...joinOptions(), identity });
    return { room };
  } catch (error) {
    return { error };
  }
}

/** Remember a room so the suite leaves it even when the case fails midway. */
function track(room: Room | undefined): void {
  if (room) openRooms.push(room);
}

/** Cleanup-only leave: never fail the test, never hang on a swept room. */
async function leaveQuietly(room: Room | undefined): Promise<void> {
  if (!room) return;
  await Promise.race([room.leave().catch(() => {}), sleep(3_000)]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Collect one message type; the suite polls the array with a bounded wait. */
function collectEditorUpdates(room: Room): { received: unknown[] } {
  const received: unknown[] = [];
  room.onMessage('editor_update', (payload: unknown) => {
    received.push(payload);
  });
  return { received };
}

function ownMapId(room: Room): string | undefined {
  const player = room.state?.players?.get(room.sessionId) as { mapId?: unknown } | undefined;
  return typeof player?.mapId === 'string' ? player.mapId : undefined;
}

/** Real waiting with polling on the condition, never a fixed sleep as proof. */
async function waitForCount(received: unknown[], count: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (received.length < count) {
    if (Date.now() > deadline) return false;
    await sleep(100);
  }
  return true;
}

/** The authoritative seat map of this client, read from the synced room state. */
async function waitForOwnMap(room: Room, mapId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (ownMapId(room) !== mapId) {
    if (Date.now() > deadline) return false;
    await sleep(100);
  }
  return true;
}

/** Move through the real map switch handler; true once the seat sits on the target map. */
async function moveToMap(room: Room, mapId: string): Promise<boolean> {
  room.send('change_map', { mapId });
  return waitForOwnMap(room, mapId, 10_000);
}

/** Demote through the real membership row, as an admin console would. */
async function demoteToMember(userId: string): Promise<void> {
  await prisma.membership.update({
    where: { tenantId_userId: { tenantId, userId } },
    data: { role: 'member' },
  });
}

beforeAll(async () => {
  const tenant = await seedTenant(prisma);
  tenantId = tenant.id;
  tenantSlug = tenant.slug;
  await seedGlobalAvatarPack();
  // The tenant default map name is `office`, so every join starts there; the
  // second map only hosts recipients moved over explicitly below.
  officeId = (await prisma.map.create({ data: { tenantId, name: 'office', meta: {} } })).id;
  studioId = (await prisma.map.create({ data: { tenantId, name: 'studio', meta: {} } })).id;
  server = await startMatchmakeServer();
});

beforeEach(async () => {
  await disposeAllRooms();
});

afterEach(async () => {
  while (openRooms.length > 0) {
    await leaveQuietly(openRooms.pop());
  }
});

afterAll(async () => {
  await stopMatchmakeServer(server);
  await prisma.presence.deleteMany({ where: { tenantId } });
  await prisma.room.deleteMany({ where: { tenantId } });
  await prisma.npc.deleteMany({ where: { tenantId } });
  await prisma.map.deleteMany({ where: { tenantId } });
  await prisma.avatarPack.deleteMany({ where: { uuid: { in: packUuids } } });
  await cleanupTenants(prisma, [tenantId]);
  await prisma.$disconnect();
});

describe('editor updates sent by a member', () => {
  it('reach no other client on the same map', async () => {
    const sender = await seedMember(prisma, tenantId, { role: 'member' });
    const receiver = await seedMember(prisma, tenantId, { role: 'admin' });
    const senderJoin = await joinWorld(sender.userId, sender.token);
    const receiverJoin = await joinWorld(receiver.userId, receiver.token);
    track(senderJoin.room);
    track(receiverJoin.room);
    expect(senderJoin.error, 'member sender must join the world').toBeUndefined();
    expect(receiverJoin.error, 'admin receiver must join the world').toBeUndefined();
    if (!senderJoin.room || !receiverJoin.room) throw new Error('member case created no rooms');
    expect(await waitForOwnMap(senderJoin.room, officeId, 10_000), 'sender starts on the office map').toBe(true);
    expect(await waitForOwnMap(receiverJoin.room, officeId, 10_000), 'receiver starts on the office map').toBe(true);
    const { received } = collectEditorUpdates(receiverJoin.room);
    senderJoin.room.send('editor_update', { type: 'reload_all' });
    await sleep(1_500);
    expect(received).toEqual([]);
  }, 30_000);
});

describe('editor updates naming another map', () => {
  it('reach no client on the named map', async () => {
    const sender = await seedMember(prisma, tenantId, { role: 'admin' });
    const sameMap = await seedMember(prisma, tenantId, { role: 'admin' });
    const otherMap = await seedMember(prisma, tenantId, { role: 'owner' });
    const senderJoin = await joinWorld(sender.userId, sender.token);
    const sameJoin = await joinWorld(sameMap.userId, sameMap.token);
    const otherJoin = await joinWorld(otherMap.userId, otherMap.token);
    track(senderJoin.room);
    track(sameJoin.room);
    track(otherJoin.room);
    expect(senderJoin.error, 'admin sender must join the world').toBeUndefined();
    expect(sameJoin.error, 'same-map receiver must join the world').toBeUndefined();
    expect(otherJoin.error, 'other-map receiver must join the world').toBeUndefined();
    if (!senderJoin.room || !sameJoin.room || !otherJoin.room) throw new Error('foreign map case created no rooms');
    expect(await waitForOwnMap(senderJoin.room, officeId, 10_000), 'sender starts on the office map').toBe(true);
    expect(await waitForOwnMap(sameJoin.room, officeId, 10_000), 'same-map receiver stays on office').toBe(true);
    expect(await moveToMap(otherJoin.room, studioId), 'other-map receiver moves to the studio map').toBe(true);
    const foreign = collectEditorUpdates(otherJoin.room);
    senderJoin.room.send('editor_update', { type: 'zone', polys: ZONE_POLYS, mapId: studioId });
    await sleep(1_500);
    expect(foreign.received).toEqual([]);
  }, 30_000);
});

describe('editor updates sent after a demotion', () => {
  it('reach no other client on the same map', async () => {
    const sender = await seedMember(prisma, tenantId, { role: 'admin' });
    const receiver = await seedMember(prisma, tenantId, { role: 'admin' });
    const senderJoin = await joinWorld(sender.userId, sender.token);
    const receiverJoin = await joinWorld(receiver.userId, receiver.token);
    track(senderJoin.room);
    track(receiverJoin.room);
    expect(senderJoin.error, 'admin sender must join the world').toBeUndefined();
    expect(receiverJoin.error, 'admin receiver must join the world').toBeUndefined();
    if (!senderJoin.room || !receiverJoin.room) throw new Error('demotion case created no rooms');
    expect(await waitForOwnMap(senderJoin.room, officeId, 10_000), 'sender starts on the office map').toBe(true);
    expect(await waitForOwnMap(receiverJoin.room, officeId, 10_000), 'receiver starts on the office map').toBe(true);
    const { received } = collectEditorUpdates(receiverJoin.room);
    await demoteToMember(sender.userId);
    senderJoin.room.send('editor_update', { type: 'reload_all' });
    await sleep(1_500);
    expect(received).toEqual([]);
  }, 30_000);
});

describe('editor updates sent by an owner', () => {
  it('reach peers on the sender map', async () => {
    const sender = await seedMember(prisma, tenantId, { role: 'owner' });
    const receiver = await seedMember(prisma, tenantId, { role: 'admin' });
    const senderJoin = await joinWorld(sender.userId, sender.token);
    const receiverJoin = await joinWorld(receiver.userId, receiver.token);
    track(senderJoin.room);
    track(receiverJoin.room);
    expect(senderJoin.error, 'owner sender must join the world').toBeUndefined();
    expect(receiverJoin.error, 'admin receiver must join the world').toBeUndefined();
    if (!senderJoin.room || !receiverJoin.room) throw new Error('owner control created no rooms');
    expect(await waitForOwnMap(senderJoin.room, officeId, 10_000), 'sender starts on the office map').toBe(true);
    expect(await waitForOwnMap(receiverJoin.room, officeId, 10_000), 'receiver starts on the office map').toBe(true);
    const { received } = collectEditorUpdates(receiverJoin.room);
    senderJoin.room.send('editor_update', { type: 'reload_all' });
    expect(await waitForCount(received, 1, 10_000), 'peer receives the owner update').toBe(true);
    expect((received[0] as { type?: unknown } | undefined)?.type).toBe('reload_all');
  }, 30_000);
});

describe('editor updates sent by an admin', () => {
  it('reach peers on the sender map', async () => {
    const sender = await seedMember(prisma, tenantId, { role: 'admin' });
    const receiver = await seedMember(prisma, tenantId, { role: 'owner' });
    const senderJoin = await joinWorld(sender.userId, sender.token);
    const receiverJoin = await joinWorld(receiver.userId, receiver.token);
    track(senderJoin.room);
    track(receiverJoin.room);
    expect(senderJoin.error, 'admin sender must join the world').toBeUndefined();
    expect(receiverJoin.error, 'owner receiver must join the world').toBeUndefined();
    if (!senderJoin.room || !receiverJoin.room) throw new Error('admin control created no rooms');
    expect(await waitForOwnMap(senderJoin.room, officeId, 10_000), 'sender starts on the office map').toBe(true);
    expect(await waitForOwnMap(receiverJoin.room, officeId, 10_000), 'receiver starts on the office map').toBe(true);
    const { received } = collectEditorUpdates(receiverJoin.room);
    senderJoin.room.send('editor_update', { type: 'zone', polys: ZONE_POLYS });
    expect(await waitForCount(received, 1, 10_000), 'peer receives the admin update').toBe(true);
    expect((received[0] as { type?: unknown } | undefined)?.type).toBe('zone');
  }, 30_000);
});
