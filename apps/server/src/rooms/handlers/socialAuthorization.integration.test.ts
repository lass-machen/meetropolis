/**
 * Bubble and zone-lock operations stay inside the sender's tenant and map.
 *
 * Both clients send the host slug as `options.tenant` (the room partition
 * key). The guest session belongs to the other tenant. That mismatch is
 * admitted only while `ZONE_PRIVACY_TENANT_ENFORCE` is `'false'`, which the
 * three cases with a client of another tenant set, so both seats land in one
 * room; every other case runs with the default (on). Shapes follow the
 * web client, plus `zone_access_request` `{ zoneName, mapId }` which only the
 * room handler reads. The zone polygon
 * is stored on the zone row and on `Map.meta.zones`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { matchMaker } from '@colyseus/core';
import { Client, type Room } from '@colyseus/sdk';
import { ZONE_PRIVACY_PROTOCOL_VERSION, type ZoneLockInfo } from '@meetropolis/shared';
import crypto from 'node:crypto';
import { createPrismaClient } from '../../db.js';
import type { WorldRoom } from '../WorldRoom.js';
import { cleanupTenants, seedMember, seedTenant, type SeededMember } from '../../testUtils/worldSeed.js';
import {
  disposeAllRooms,
  startMatchmakeServer,
  stopMatchmakeServer,
  type MatchmakeTestServer,
} from '../../testUtils/matchmakeHarness.js';

if (!process.env.DATABASE_URL) {
  throw new Error('socialAuthorization.integration.test.ts needs DATABASE_URL for a migrated test database');
}

const prisma = createPrismaClient();
const QUIET_MS = 1_500;
const STEP_MS = 10_000;
const CASE_MS = 30_000;
const ZONE_NAME = 'north-wing';
const FORGED_GROUP_ID = 'client-supplied-group';
const INSIDE = { x: 40, y: 40 };
const OUTSIDE = { x: 400, y: 400 };
const ZONE_POINTS = [
  { x: 0, y: 0 },
  { x: 80, y: 0 },
  { x: 80, y: 80 },
  { x: 0, y: 80 },
];

const packUuids: string[] = [];
const openRooms: Room[] = [];
let server: MatchmakeTestServer | undefined;
let hostId = '';
let guestId = '';
let hostSlug = '';
let avatarId = '';
let officeId = '';
let studioId = '';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) return false;
    await sleep(50);
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function worldOf(room: Room): WorldRoom {
  const found = matchMaker.getLocalRoomById(room.roomId);
  if (!found) throw new Error('world room is not running');
  return found as WorldRoom;
}

function lockKey(): string {
  return `${officeId}:${ZONE_NAME}`;
}

function zoneLock(room: Room): ZoneLockInfo | undefined {
  return worldOf(room).zoneLockState.locks.get(lockKey());
}

function accessIds(room: Room): string[] {
  return [...(zoneLock(room)?.accessList ?? [])];
}

function pendingIds(room: Room): string[] {
  return zoneLock(room)?.pendingRequests.map((request) => request.sessionId) ?? [];
}

function groupMembers(room: Room, sessionId: string): string[] | undefined {
  for (const members of Object.values(worldOf(room).bubbleGroups)) {
    if (members.includes(sessionId)) return [...members];
  }
  return undefined;
}

function groupKey(room: Room, sessionId: string): string | undefined {
  for (const [id, members] of Object.entries(worldOf(room).bubbleGroups)) {
    if (members.includes(sessionId)) return id;
  }
  return undefined;
}

function playerMap(room: Room): string | undefined {
  const player = room.state.players.get(room.sessionId) as { mapId?: unknown } | undefined;
  return typeof player?.mapId === 'string' ? player.mapId : undefined;
}

function collect(room: Room, type: string): unknown[] {
  const received: unknown[] = [];
  room.onMessage(type, (payload: unknown) => {
    received.push(payload);
  });
  return received;
}

function bubbleMentions(payloads: unknown[], sessionId: string): boolean {
  return payloads.some((payload) => {
    if (!isRecord(payload)) return false;
    if (stringList(payload.members).includes(sessionId)) return true;
    if (!Array.isArray(payload.groups)) return false;
    return payload.groups.some((group) => isRecord(group) && stringList(group.members).includes(sessionId));
  });
}

function bubbleUsesId(payloads: unknown[], groupId: string): boolean {
  return payloads.some((payload) => {
    if (!isRecord(payload) || !Array.isArray(payload.groups)) return false;
    return payload.groups.some((group) => isRecord(group) && group.id === groupId);
  });
}

function lockMentions(payloads: unknown[], zoneName: string, mapId: string): boolean {
  return payloads.some((payload) => {
    if (!isRecord(payload) || !Array.isArray(payload.locks)) return false;
    return payload.locks.some((lock) => isRecord(lock) && lock.zoneName === zoneName && lock.mapId === mapId);
  });
}

function deniedZone(payloads: unknown[], zoneName: string): boolean {
  return payloads.some((payload) => isRecord(payload) && payload.zoneName === zoneName);
}

async function leaveQuietly(room: Room | undefined): Promise<void> {
  if (!room) return;
  await Promise.race([room.leave().catch(() => undefined), sleep(3_000)]);
}

async function connect(token: string, at: { x: number; y: number }): Promise<Room> {
  const client = new Client(server?.base ?? '');
  client.auth.token = token;
  const room = await client.joinOrCreate('world', {
    tenant: hostSlug,
    avatarId,
    zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
    x: at.x,
    y: at.y,
  });
  openRooms.push(room);
  const seated = await waitUntil(() => worldOf(room).state.players.has(room.sessionId), STEP_MS);
  expect(seated, 'the client has a seat').toBe(true);
  return room;
}

function expectSameRoom(rooms: Room[]): void {
  const roomId = rooms[0]?.roomId;
  expect(roomId, 'a world room exists').toBeTruthy();
  for (const room of rooms) expect(room.roomId, 'clients share one world room').toBe(roomId);
}

async function waitForMap(room: Room, mapId: string): Promise<void> {
  const arrived = await waitUntil(() => playerMap(room) === mapId, STEP_MS);
  expect(arrived, 'the seat is on the expected map').toBe(true);
}

async function formGroup(sender: Room, peer: Room): Promise<void> {
  sender.send('bubble_update', { members: [sender.sessionId, peer.sessionId] });
  const formed = await waitUntil(
    () => (groupMembers(sender, sender.sessionId) ?? []).includes(peer.sessionId),
    STEP_MS,
  );
  expect(formed, 'the sender and the peer share a group').toBe(true);
}

async function lockZone(room: Room): Promise<void> {
  room.send('zone_lock', { zoneName: ZONE_NAME });
  const locked = await waitUntil(() => accessIds(room).includes(room.sessionId), STEP_MS);
  expect(locked, 'the zone is locked by the sender').toBe(true);
}

async function moveTo(room: Room, mapId: string): Promise<void> {
  room.send('change_map', { mapId });
  await waitForMap(room, mapId);
}

async function seedPlayers(tenantId: string, count: number): Promise<SeededMember[]> {
  return Promise.all(Array.from({ length: count }, () => seedMember(prisma, tenantId)));
}

async function seedGlobalAvatarPack(): Promise<void> {
  const uuid = `world-social-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await prisma.avatarPack.create({
    data: {
      uuid,
      name: uuid,
      description: 'shared world join fixture',
      author: 'world-social-fixture',
      version: '1',
      avatars: [{ key: 'business_man' }],
      tenantId: null,
    },
  });
  packUuids.push(uuid);
  avatarId = `${uuid}:business_man`;
}

async function seedMap(tenantId: string, name: string, withZone: boolean): Promise<string> {
  const created = await prisma.map.create({
    data: {
      tenantId,
      name,
      width: 50,
      height: 50,
      tileWidth: 16,
      tileHeight: 16,
      meta: withZone ? { spawn: INSIDE, zones: [{ name: ZONE_NAME, points: ZONE_POINTS }] } : {},
    },
  });
  if (!withZone) return created.id;
  const floor = await prisma.room.create({ data: { name: 'floor', tenantId, mapId: created.id } });
  await prisma.zone.create({
    data: {
      name: ZONE_NAME,
      polygon: ZONE_POINTS,
      type: 'default',
      roomId: floor.id,
      mapId: created.id,
      tenantId,
    },
  });
  return created.id;
}

beforeAll(async () => {
  const host = await seedTenant(prisma);
  const guest = await seedTenant(prisma);
  hostId = host.id;
  hostSlug = host.slug;
  guestId = guest.id;
  await seedGlobalAvatarPack();
  officeId = await seedMap(hostId, 'office', true);
  studioId = await seedMap(hostId, 'studio', false);
  await seedMap(guestId, 'office', false);
  server = await startMatchmakeServer();
}, CASE_MS);

beforeEach(async () => {
  await disposeAllRooms();
}, CASE_MS);

afterEach(async () => {
  while (openRooms.length > 0) await leaveQuietly(openRooms.pop());
}, CASE_MS);

afterAll(async () => {
  if (server) await stopMatchmakeServer(server);
  const tenantIds = [hostId, guestId].filter((id) => id.length > 0);
  if (tenantIds.length > 0) {
    await prisma.zone.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.presence.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.room.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.map.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await cleanupTenants(prisma, tenantIds);
  }
  if (packUuids.length > 0) await prisma.avatarPack.deleteMany({ where: { uuid: { in: packUuids } } });
  await prisma.$disconnect();
}, CASE_MS);

describe('bubble updates from another tenant', () => {
  // A client of another tenant shares the room only while the tenant-room match is explicitly off.
  beforeEach(() => {
    vi.stubEnv('ZONE_PRIVACY_TENANT_ENFORCE', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it(
    'leave the other tenant group unchanged',
    async () => {
      const [hostA, hostB] = await seedPlayers(hostId, 2);
      const [guest] = await seedPlayers(guestId, 1);
      const alice = await connect(hostA.token, INSIDE);
      const bob = await connect(hostB.token, INSIDE);
      const eve = await connect(guest.token, INSIDE);
      expectSameRoom([alice, bob, eve]);
      const seen = collect(alice, 'bubble_state');
      await formGroup(alice, bob);
      expect(await waitUntil(() => seen.length > 0, STEP_MS), 'the group was announced').toBe(true);
      seen.length = 0;
      eve.send('bubble_update', { members: [eve.sessionId, alice.sessionId] });
      await sleep(QUIET_MS);
      expect(groupMembers(alice, alice.sessionId)).toEqual([alice.sessionId, bob.sessionId]);
      expect(groupMembers(eve, eve.sessionId)).toBeUndefined();
      expect(seen).toEqual([]);
    },
    CASE_MS,
  );
});

describe('bubble updates from another map', () => {
  it(
    'leave the group on the original map unchanged',
    async () => {
      const [hostA, hostB, hostC] = await seedPlayers(hostId, 3);
      const alice = await connect(hostA.token, INSIDE);
      const bob = await connect(hostB.token, INSIDE);
      const carol = await connect(hostC.token, INSIDE);
      expectSameRoom([alice, bob, carol]);
      const seen = collect(alice, 'bubble_state');
      await formGroup(alice, bob);
      await moveTo(carol, studioId);
      expect(await waitUntil(() => seen.length > 0, STEP_MS), 'the group was announced').toBe(true);
      seen.length = 0;
      carol.send('bubble_update', { members: [carol.sessionId, alice.sessionId] });
      await sleep(QUIET_MS);
      expect(groupMembers(alice, alice.sessionId)).toEqual([alice.sessionId, bob.sessionId]);
      expect(seen).toEqual([]);
    },
    CASE_MS,
  );
});

describe('bubble updates from outside a group', () => {
  it(
    'leave that group intact',
    async () => {
      const [hostA, hostB, hostC] = await seedPlayers(hostId, 3);
      const alice = await connect(hostA.token, INSIDE);
      const bob = await connect(hostB.token, INSIDE);
      const carol = await connect(hostC.token, INSIDE);
      expectSameRoom([alice, bob, carol]);
      const seen = collect(alice, 'bubble_state');
      await formGroup(alice, bob);
      expect(await waitUntil(() => seen.length > 0, STEP_MS), 'the group was announced').toBe(true);
      seen.length = 0;
      carol.send('bubble_update', { members: [alice.sessionId] });
      await sleep(QUIET_MS);
      expect(groupMembers(alice, alice.sessionId)).toEqual([alice.sessionId, bob.sessionId]);
      expect(seen).toEqual([]);
    },
    CASE_MS,
  );
});

describe('bubble updates that rename a group', () => {
  it(
    'keep the existing group id',
    async () => {
      const [hostA, hostB] = await seedPlayers(hostId, 2);
      const alice = await connect(hostA.token, INSIDE);
      const bob = await connect(hostB.token, INSIDE);
      expectSameRoom([alice, bob]);
      const seen = collect(alice, 'bubble_state');
      await formGroup(alice, bob);
      const id = groupKey(alice, alice.sessionId);
      expect(id, 'the server assigned a group id').toBeTruthy();
      expect(await waitUntil(() => seen.length > 0, STEP_MS), 'the group was announced').toBe(true);
      seen.length = 0;
      alice.send('bubble_update', { id: FORGED_GROUP_ID, members: [alice.sessionId, bob.sessionId] });
      await sleep(QUIET_MS);
      expect(groupKey(alice, alice.sessionId)).toBe(id);
      expect(Object.keys(worldOf(alice).bubbleGroups)).not.toContain(FORGED_GROUP_ID);
      expect(bubbleUsesId(seen, FORGED_GROUP_ID)).toBe(false);
    },
    CASE_MS,
  );
});

describe('bubble state sent when a client joins', () => {
  // A client of another tenant shares the room only while the tenant-room match is explicitly off.
  beforeEach(() => {
    vi.stubEnv('ZONE_PRIVACY_TENANT_ENFORCE', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it(
    'omits groups from another tenant',
    async () => {
      const [hostA, hostB] = await seedPlayers(hostId, 2);
      const [guest] = await seedPlayers(guestId, 1);
      const alice = await connect(hostA.token, INSIDE);
      const bob = await connect(hostB.token, INSIDE);
      await formGroup(alice, bob);
      const eve = await connect(guest.token, INSIDE);
      const full = collect(eve, 'full_state');
      const bubbles = collect(eve, 'bubble_state');
      expectSameRoom([alice, eve]);
      await sleep(QUIET_MS);
      expect(full.length, 'the join seed was delivered').toBeGreaterThan(0);
      expect(bubbleMentions(bubbles, alice.sessionId)).toBe(false);
      expect(bubbleMentions(bubbles, bob.sessionId)).toBe(false);
    },
    CASE_MS,
  );
});

describe('zone access requests that name another map', () => {
  it(
    'leave that lock without a new request',
    async () => {
      const [hostA, hostB] = await seedPlayers(hostId, 2);
      const alice = await connect(hostA.token, INSIDE);
      const bob = await connect(hostB.token, OUTSIDE);
      expectSameRoom([alice, bob]);
      await waitForMap(alice, officeId);
      await waitForMap(bob, officeId);
      const seen = collect(alice, 'zone_lock_state');
      await lockZone(alice);
      seen.length = 0;
      await moveTo(bob, studioId);
      bob.send('zone_access_request', { zoneName: ZONE_NAME, mapId: officeId });
      await sleep(QUIET_MS);
      expect(pendingIds(alice)).toEqual([]);
      expect(accessIds(alice)).toEqual([alice.sessionId]);
      expect(seen).toEqual([]);
    },
    CASE_MS,
  );
});

describe('zone access responses without a pending request', () => {
  it(
    'leave the access list unchanged',
    async () => {
      const [hostA, hostB] = await seedPlayers(hostId, 2);
      const alice = await connect(hostA.token, INSIDE);
      const carol = await connect(hostB.token, OUTSIDE);
      expectSameRoom([alice, carol]);
      await waitForMap(alice, officeId);
      await waitForMap(carol, officeId);
      const seen = collect(carol, 'zone_lock_state');
      await lockZone(alice);
      const before = accessIds(alice);
      seen.length = 0;
      alice.send('zone_access_response', { zoneName: ZONE_NAME, sessionId: carol.sessionId, approved: true });
      await sleep(QUIET_MS);
      expect(accessIds(alice)).toEqual(before);
      expect(pendingIds(alice)).toEqual([]);
      expect(seen).toEqual([]);
    },
    CASE_MS,
  );
});

describe('zone lock state sent when a client joins', () => {
  // A client of another tenant shares the room only while the tenant-room match is explicitly off.
  beforeEach(() => {
    vi.stubEnv('ZONE_PRIVACY_TENANT_ENFORCE', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it(
    'omits locks from another tenant',
    async () => {
      const [host] = await seedPlayers(hostId, 1);
      const [guest] = await seedPlayers(guestId, 1);
      const alice = await connect(host.token, INSIDE);
      await waitForMap(alice, officeId);
      await lockZone(alice);
      const eve = await connect(guest.token, OUTSIDE);
      const full = collect(eve, 'full_state');
      const locks = collect(eve, 'zone_lock_state');
      expectSameRoom([alice, eve]);
      await sleep(QUIET_MS);
      expect(full.length, 'the join seed was delivered').toBeGreaterThan(0);
      expect(lockMentions(locks, ZONE_NAME, officeId)).toBe(false);
    },
    CASE_MS,
  );
});

describe('a player forms a bubble', () => {
  it(
    'groups the sender with the named peer',
    async () => {
      const [hostA, hostB] = await seedPlayers(hostId, 2);
      const alice = await connect(hostA.token, INSIDE);
      const bob = await connect(hostB.token, INSIDE);
      const seen = collect(bob, 'bubble_state');
      alice.send('bubble_update', { members: [alice.sessionId, bob.sessionId] });
      const announced = await waitUntil(
        () => bubbleMentions(seen, alice.sessionId) && bubbleMentions(seen, bob.sessionId),
        STEP_MS,
      );
      expect(announced).toBe(true);
      expect(groupMembers(alice, alice.sessionId)).toEqual([alice.sessionId, bob.sessionId]);
    },
    CASE_MS,
  );
});

describe('a player joins a bubble', () => {
  it(
    'adds the sender to the existing group',
    async () => {
      const [hostA, hostB, hostC] = await seedPlayers(hostId, 3);
      const alice = await connect(hostA.token, INSIDE);
      const bob = await connect(hostB.token, INSIDE);
      const carol = await connect(hostC.token, INSIDE);
      await formGroup(alice, bob);
      const id = groupKey(alice, alice.sessionId);
      expect(id).toBeTruthy();
      const seen = collect(bob, 'bubble_state');
      carol.send('bubble_update', { id, members: [alice.sessionId, bob.sessionId, carol.sessionId] });
      const joined = await waitUntil(() => bubbleMentions(seen, carol.sessionId), STEP_MS);
      expect(joined).toBe(true);
      expect(groupMembers(alice, alice.sessionId)).toEqual([alice.sessionId, bob.sessionId, carol.sessionId]);
    },
    CASE_MS,
  );
});

describe('a player expands a bubble', () => {
  it(
    'adds the named peer to the sender group',
    async () => {
      const [hostA, hostB, hostC] = await seedPlayers(hostId, 3);
      const alice = await connect(hostA.token, INSIDE);
      const bob = await connect(hostB.token, INSIDE);
      const carol = await connect(hostC.token, INSIDE);
      await formGroup(alice, bob);
      const id = groupKey(alice, alice.sessionId);
      expect(id).toBeTruthy();
      const seen = collect(carol, 'bubble_state');
      alice.send('bubble_update', { id, members: [alice.sessionId, bob.sessionId, carol.sessionId] });
      const expanded = await waitUntil(() => bubbleMentions(seen, carol.sessionId), STEP_MS);
      expect(expanded).toBe(true);
      expect(groupKey(alice, alice.sessionId)).toBe(id);
      expect(groupMembers(alice, alice.sessionId)).toEqual([alice.sessionId, bob.sessionId, carol.sessionId]);
    },
    CASE_MS,
  );
});

describe('a player leaves a bubble', () => {
  it(
    'keeps every member except the sender',
    async () => {
      const [hostA, hostB, hostC] = await seedPlayers(hostId, 3);
      const alice = await connect(hostA.token, INSIDE);
      const bob = await connect(hostB.token, INSIDE);
      const carol = await connect(hostC.token, INSIDE);
      await formGroup(alice, bob);
      const id = groupKey(alice, alice.sessionId);
      expect(id).toBeTruthy();
      alice.send('bubble_update', { id, members: [alice.sessionId, bob.sessionId, carol.sessionId] });
      const expanded = await waitUntil(
        () => (groupMembers(alice, alice.sessionId) ?? []).includes(carol.sessionId),
        STEP_MS,
      );
      expect(expanded).toBe(true);
      const previous = groupMembers(alice, alice.sessionId) ?? [];
      const remaining = previous.filter((sessionId) => sessionId !== alice.sessionId);
      alice.send('bubble_update', { id, members: remaining });
      const left = await waitUntil(() => {
        const now = groupMembers(bob, bob.sessionId);
        if (!now || now.length !== remaining.length) return false;
        return remaining.every((sessionId, index) => now[index] === sessionId);
      }, STEP_MS);
      expect(left).toBe(true);
    },
    CASE_MS,
  );
});

describe('a player locks a zone', () => {
  it(
    'records the sender on the zone access list',
    async () => {
      const [host] = await seedPlayers(hostId, 1);
      const alice = await connect(host.token, INSIDE);
      await waitForMap(alice, officeId);
      const seen = collect(alice, 'zone_lock_state');
      alice.send('zone_lock', { zoneName: ZONE_NAME });
      const recorded = await waitUntil(
        () => lockMentions(seen, ZONE_NAME, officeId) && accessIds(alice).includes(alice.sessionId),
        STEP_MS,
      );
      expect(recorded).toBe(true);
    },
    CASE_MS,
  );
});

describe('a player approves a zone request', () => {
  it(
    'adds the requester to the access list',
    async () => {
      const [hostA, hostB] = await seedPlayers(hostId, 2);
      const alice = await connect(hostA.token, INSIDE);
      const bob = await connect(hostB.token, OUTSIDE);
      await waitForMap(alice, officeId);
      await waitForMap(bob, officeId);
      await lockZone(alice);
      bob.send('zone_access_request', { zoneName: ZONE_NAME, mapId: officeId });
      expect(await waitUntil(() => pendingIds(alice).includes(bob.sessionId), STEP_MS)).toBe(true);
      alice.send('zone_access_response', { zoneName: ZONE_NAME, sessionId: bob.sessionId, approved: true });
      const approved = await waitUntil(() => accessIds(alice).includes(bob.sessionId), STEP_MS);
      expect(approved).toBe(true);
      expect(pendingIds(alice)).not.toContain(bob.sessionId);
    },
    CASE_MS,
  );
});

describe('a player denies a zone request', () => {
  it(
    'tells the requester the zone stays closed',
    async () => {
      const [hostA, hostB] = await seedPlayers(hostId, 2);
      const alice = await connect(hostA.token, INSIDE);
      const bob = await connect(hostB.token, OUTSIDE);
      await waitForMap(alice, officeId);
      await waitForMap(bob, officeId);
      await lockZone(alice);
      const denied = collect(bob, 'zone_access_denied');
      bob.send('zone_access_request', { zoneName: ZONE_NAME, mapId: officeId });
      expect(await waitUntil(() => pendingIds(alice).includes(bob.sessionId), STEP_MS)).toBe(true);
      alice.send('zone_access_response', { zoneName: ZONE_NAME, sessionId: bob.sessionId, approved: false });
      const told = await waitUntil(() => deniedZone(denied, ZONE_NAME), STEP_MS);
      expect(told).toBe(true);
      expect(accessIds(alice)).toEqual([alice.sessionId]);
      expect(pendingIds(alice)).not.toContain(bob.sessionId);
    },
    CASE_MS,
  );
});

describe('a player leaves the room', () => {
  it(
    'releases the zone lock when nobody with access remains',
    async () => {
      const [hostA, hostB] = await seedPlayers(hostId, 2);
      const alice = await connect(hostA.token, INSIDE);
      const bob = await connect(hostB.token, OUTSIDE);
      await waitForMap(alice, officeId);
      await waitForMap(bob, officeId);
      await lockZone(alice);
      const seen = collect(bob, 'zone_lock_state');
      await alice.leave();
      const released = await waitUntil(() => !zoneLock(bob) && seen.length > 0, STEP_MS);
      expect(released).toBe(true);
      expect(lockMentions(seen, ZONE_NAME, officeId)).toBe(false);
    },
    CASE_MS,
  );
});
