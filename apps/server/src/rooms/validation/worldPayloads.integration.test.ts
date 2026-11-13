/**
 * Runtime checks for move, do-not-disturb, and editor-state payloads.
 *
 * Real Colyseus (`testUtils/matchmakeHarness.ts`), real PostgreSQL (`db.js` is
 * not mocked), and the HTTP API on the same server (`configureApp`: cookie
 * parser, tenant middleware, `registerApi`). Seeds come from
 * `testUtils/worldSeed.ts`.
 *
 * Ten cases fail on the unfixed basis: a move or do-not-disturb message is
 * applied and broadcast as sent, and an editor body with a bad tileset, polygon,
 * capacity, or zone type is stored. The rejection counter is absent there, so
 * its value reads as 0. The controls hold on the unfixed basis and with the limits.
 */

import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import express from 'express';
import { Counter } from 'prom-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import { createPrismaClient } from '../../db.js';
import { registerApi } from '../../api.js';
import { tenantMiddleware } from '../../tenancy.js';
import { registry } from '../../metrics.js';
import { cleanupTenants, seedMember, seedTenant, type SeededMember } from '../../testUtils/worldSeed.js';
import {
  disposeAllRooms,
  startMatchmakeServer,
  stopMatchmakeServer,
  type MatchmakeTestServer,
} from '../../testUtils/matchmakeHarness.js';

if (!process.env.DATABASE_URL) {
  throw new Error('worldPayloads.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const REJECTION_METRIC = 'meetropolis_world_payload_rejected_total';
const TILES_X = 10;
const TILES_Y = 8;
const TILE_PX = 32;
/** Closed pixel window of the seeded map: tiles times tile size, both edges included. */
const MAP_WIDTH = TILES_X * TILE_PX;
const MAP_HEIGHT = TILES_Y * TILE_PX;
const INTERIOR_X = 32;
const INTERIOR_Y = 32;
const MOVE_GAP_MS = 100;

process.env.DEFAULT_TENANT_SLUG = `wp-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

const prisma = createPrismaClient();
const packUuids: string[] = [];
const moveBag: unknown[] = [];
const dndBag: unknown[] = [];
const editorBag: unknown[] = [];

let server: MatchmakeTestServer | undefined;
let previousGameServer: typeof global.gameServer;
let tenantId = '';
let tenantSlug = '';
let mapId = '';
let fixturePackUuid = '';
let admin: SeededMember | undefined;
let guest: SeededMember | undefined;
let actor: Room | undefined;
let peer: Room | undefined;

type Direction = 'up' | 'down' | 'left' | 'right';
type RejectionType = 'move' | 'dnd_status' | 'editor_state';
type RejectionReason = 'schema' | 'bounds';

interface MoveSample {
  x: number;
  y: number;
  direction: string;
}

interface Pose {
  x: number;
  y: number;
  direction: string;
  dnd: boolean;
  mapId: string;
}

interface Point {
  x: number;
  y: number;
}

interface EditorTileset {
  key: string;
  dataUrl: string;
  tileWidth: number;
  tileHeight: number;
  margin?: number;
  spacing?: number;
  category?: string;
}

const KNOWN_TILESET: EditorTileset = {
  key: 'floor',
  dataUrl: 'x',
  tileWidth: 16,
  tileHeight: 16,
  margin: 0,
  spacing: 0,
  category: 'ground',
};

function triangle(): Point[] {
  return [
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: 0, y: 8 },
  ];
}

function points(count: number): Point[] {
  const list: Point[] = [];
  for (let index = 0; index < count; index += 1) list.push({ x: index, y: 0 });
  return list;
}

function tilesetList(count: number): EditorTileset[] {
  const list: EditorTileset[] = [];
  for (let index = 0; index < count; index += 1) {
    list.push({ key: `sheet-${index}`, dataUrl: 'x', tileWidth: 1, tileHeight: 1 });
  }
  return list;
}

function zoneList(count: number): Array<{ name: string; points: Point[] }> {
  const shape = triangle();
  const list: Array<{ name: string; points: Point[] }> = [];
  for (let index = 0; index < count; index += 1) list.push({ name: `area-${index}`, points: shape });
  return list;
}

function configureApi(app: express.Express): void {
  app.use(cookieParser());
  app.use(express.json());
  app.use(tenantMiddleware as unknown as express.RequestHandler);
  // Routes finish registering before the first request; listen does not await this.
  void registerApi(app);
}

async function seedGlobalAvatarPack(): Promise<void> {
  const uuid = `pack-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await prisma.avatarPack.create({
    data: {
      uuid,
      name: uuid,
      description: 'world payload join fixture',
      author: 'payload-fixture',
      version: '1',
      avatars: [{ key: 'business_man' }],
      tenantId: null,
    },
  });
  packUuids.push(uuid);
  fixturePackUuid = uuid;
}

async function rejectionCount(type: RejectionType, reason: RejectionReason): Promise<number> {
  const metric = registry.getSingleMetric(REJECTION_METRIC);
  if (!(metric instanceof Counter)) return 0;
  const snapshot = await metric.get();
  let total = 0;
  for (const sample of snapshot.values) {
    if (String(sample.labels.type) === type && String(sample.labels.reason) === reason) total += sample.value;
  }
  return total;
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

async function elapsed(timeoutMs: number): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  return true;
}

function poseOf(room: Room): Pose | null {
  for (const player of room.state.players.values()) {
    if (player.id !== room.sessionId) continue;
    return {
      x: player.x,
      y: player.y,
      direction: player.direction,
      dnd: player.dnd,
      mapId: player.mapId,
    };
  }
  return null;
}

function samePose(left: Pose | null, right: Pose | null): boolean {
  if (!left || !right) return false;
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.direction === right.direction &&
    left.dnd === right.dnd &&
    left.mapId === right.mapId
  );
}

function messageId(message: unknown): string | null {
  if (typeof message !== 'object' || message === null || !('id' in message)) return null;
  return typeof message.id === 'string' ? message.id : null;
}

async function joinMember(member: SeededMember): Promise<Room> {
  const client = new Client(server?.base ?? '');
  client.auth.token = member.token;
  return client.joinOrCreate('world', {
    tenant: tenantSlug,
    identity: member.userId,
    avatarId: `${fixturePackUuid}:business_man`,
    zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
  });
}

function wirePeer(actorSessionId: string): void {
  if (!peer) return;
  peer.onMessage('player_moved', (message: unknown) => {
    if (messageId(message) === actorSessionId) moveBag.push(message);
  });
  peer.onMessage('player_dnd', (message: unknown) => {
    if (messageId(message) === actorSessionId) dndBag.push(message);
  });
  peer.onMessage('editor_update', (message: unknown) => {
    editorBag.push(message);
  });
}

async function leaveRoom(room: Room | undefined): Promise<void> {
  if (!room) return;
  await Promise.race([
    room.leave().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
}

/** Repeat a valid move until the cache from room creation is visible in the pose. */
async function land(x: number, y: number, direction: Direction): Promise<boolean> {
  const room = actor;
  if (!room) return false;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    room.send('move', { x, y, direction });
    const arrived = await waitUntil(() => {
      const pose = poseOf(room);
      return pose !== null && pose.x === x && pose.y === y && pose.direction === direction;
    }, 200);
    if (arrived) return true;
    await elapsed(MOVE_GAP_MS);
  }
  return false;
}

async function expectRejectedSignal(
  type: RejectionType,
  reason: RejectionReason,
  send: () => void,
  changed: () => boolean,
  bag: unknown[],
): Promise<void> {
  bag.length = 0;
  const before = await rejectionCount(type, reason);
  send();
  const sawChange = await waitUntil(() => bag.length > 0 || changed(), 1_500);
  expect(sawChange).toBe(false);
  expect(bag).toHaveLength(0);
  expect(changed()).toBe(false);
  expect((await rejectionCount(type, reason)) - before).toBe(1);
}

async function expectRejectedMove(payload: MoveSample, reason: RejectionReason): Promise<void> {
  const room = actor;
  if (!room) throw new Error('world client is not connected');
  expect(await land(INTERIOR_X, INTERIOR_Y, 'down')).toBe(true);
  await elapsed(MOVE_GAP_MS);
  const before = poseOf(room);
  await expectRejectedSignal(
    'move',
    reason,
    () => room.send('move', payload),
    () => !samePose(poseOf(room), before),
    moveBag,
  );
}

async function putEditor(body: unknown): Promise<number> {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const response = await fetch(`${server?.base ?? ''}/maps/${mapId}/editor-state`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${admin?.token ?? ''}`, 'content-type': 'application/json' },
    body: payload,
  });
  await response.text();
  return response.status;
}

async function getEditor(): Promise<unknown> {
  const response = await fetch(`${server?.base ?? ''}/maps/${mapId}/editor-state`, {
    headers: { authorization: `Bearer ${admin?.token ?? ''}` },
  });
  const body: unknown = await response.json();
  return body;
}

async function editorSnapshot(): Promise<string> {
  const map = await prisma.map.findUnique({ where: { id: mapId }, select: { meta: true } });
  const zones = await prisma.zone.findMany({
    where: { mapId },
    orderBy: { name: 'asc' },
    select: {
      name: true,
      capacity: true,
      polygon: true,
      type: true,
      portalTarget: true,
      portalSpawnX: true,
      portalSpawnY: true,
    },
  });
  return JSON.stringify({ meta: map?.meta ?? null, zones });
}

async function tilesetCount(): Promise<number> {
  const map = await prisma.map.findUnique({ where: { id: mapId }, select: { meta: true } });
  const meta = map?.meta;
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta) || !('tilesets' in meta)) return 0;
  return Array.isArray(meta.tilesets) ? meta.tilesets.length : 0;
}

async function resetEditor(): Promise<void> {
  editorBag.length = 0;
  const status = await putEditor({
    tilesets: [KNOWN_TILESET],
    zones: [{ name: 'Lobby', type: 'default', points: triangle(), capacity: 4 }],
    backgroundColor: '#112233',
    spawn: { x: INTERIOR_X, y: INTERIOR_Y },
    replaceZones: true,
  });
  if (status !== 200) throw new Error(`editor reset returned ${status}`);
  const heard = await waitUntil(() => editorBag.length > 0, 1_500);
  if (!heard) throw new Error('editor reset produced no editor update');
  editorBag.length = 0;
}

async function expectRejectedEditor(body: unknown): Promise<void> {
  await resetEditor();
  const beforeSnap = await editorSnapshot();
  const before = await rejectionCount('editor_state', 'schema');
  editorBag.length = 0;
  const status = await putEditor(body);
  const heard = await waitUntil(() => editorBag.length > 0, 1_500);
  expect(status).toBe(400);
  expect(await editorSnapshot()).toBe(beforeSnap);
  expect(heard).toBe(false);
  expect((await rejectionCount('editor_state', 'schema')) - before).toBe(1);
}

async function expectAcceptedEditor(body: unknown): Promise<void> {
  const before = await rejectionCount('editor_state', 'schema');
  editorBag.length = 0;
  const status = await putEditor(body);
  const heard = await waitUntil(() => editorBag.length > 0, 1_500);
  expect(status).toBe(200);
  expect(heard).toBe(true);
  expect((await rejectionCount('editor_state', 'schema')) - before).toBe(0);
}

beforeAll(async () => {
  tenantSlug = process.env.DEFAULT_TENANT_SLUG ?? '';
  tenantId = (await seedTenant(prisma, { slug: tenantSlug })).id;
  await seedGlobalAvatarPack();
  mapId = (
    await prisma.map.create({
      data: {
        tenantId,
        name: 'office',
        width: TILES_X,
        height: TILES_Y,
        tileWidth: TILE_PX,
        tileHeight: TILE_PX,
        meta: { spawn: { x: INTERIOR_X, y: INTERIOR_Y } },
      },
    })
  ).id;
  admin = await seedMember(prisma, tenantId, { role: 'admin' });
  guest = await seedMember(prisma, tenantId, { role: 'member' });
  server = await startMatchmakeServer({ configureApp: configureApi });
  previousGameServer = global.gameServer;
  global.gameServer = server.gameServer;
}, 30_000);

beforeEach(async () => {
  await disposeAllRooms();
  moveBag.length = 0;
  dndBag.length = 0;
  editorBag.length = 0;
  if (!admin || !guest) throw new Error('seeded members are missing');
  actor = await joinMember(admin);
  try {
    peer = await joinMember(guest);
    wirePeer(actor.sessionId);
    const synced = await waitUntil(() => poseOf(actor as Room)?.mapId === mapId, 5_000);
    if (!synced) throw new Error(`joined map ${poseOf(actor)?.mapId ?? 'missing'} is not the seeded map`);
  } catch (error) {
    await leaveRoom(actor);
    await leaveRoom(peer);
    actor = undefined;
    peer = undefined;
    throw error;
  }
}, 30_000);

afterEach(async () => {
  await leaveRoom(actor);
  await leaveRoom(peer);
  actor = undefined;
  peer = undefined;
});

afterAll(async () => {
  await disposeAllRooms();
  if (server) await stopMatchmakeServer(server);
  global.gameServer = previousGameServer;
  if (tenantId) {
    await prisma.zone.deleteMany({ where: { tenantId } });
    await prisma.presence.deleteMany({ where: { tenantId } });
    await prisma.room.deleteMany({ where: { tenantId } });
    await prisma.map.deleteMany({ where: { tenantId } });
    await prisma.avatarPack.deleteMany({ where: { uuid: { in: packUuids } } });
    await cleanupTenants(prisma, [tenantId]);
  }
  await prisma.$disconnect();
}, 30_000);

describe('move payload', () => {
  it('move payload > drops a coordinate that is not a number', async () => {
    await expectRejectedMove({ x: Number.NaN, y: INTERIOR_Y, direction: 'up' }, 'schema');
  }, 30_000);

  it('move payload > drops an infinite coordinate', async () => {
    await expectRejectedMove({ x: Number.POSITIVE_INFINITY, y: INTERIOR_Y, direction: 'up' }, 'schema');
  }, 30_000);

  it('move payload > drops a coordinate outside the map', async () => {
    await expectRejectedMove({ x: MAP_WIDTH + 1, y: 0, direction: 'left' }, 'bounds');
  }, 30_000);

  it('move payload > drops an unknown direction', async () => {
    await expectRejectedMove({ x: INTERIOR_X, y: INTERIOR_Y, direction: 'north' }, 'schema');
  }, 30_000);
});

describe('dnd payload', () => {
  it('dnd payload > drops a status that is not a boolean', async () => {
    const room = actor;
    if (!room) throw new Error('world client is not connected');
    const before = poseOf(room);
    await expectRejectedSignal(
      'dnd_status',
      'schema',
      () => room.send('dnd_status', { dnd: 'yes' }),
      () => !samePose(poseOf(room), before),
      dndBag,
    );
  }, 30_000);
});

describe('editor state payload', () => {
  it('editor state payload > rejects a tileset element that is not a tileset', async () => {
    await expectRejectedEditor({ tilesets: [{ key: 1 }] });
  }, 30_000);

  it('editor state payload > rejects a zone polygon that is not a point list', async () => {
    await expectRejectedEditor({
      zones: [{ name: 'Gate', polygon: { closed: true } }],
      replaceZones: true,
    });
  }, 30_000);

  it('editor state payload > rejects a zone capacity that is not an allowed integer', async () => {
    await expectRejectedEditor({
      zones: [{ name: 'Hall', capacity: -1, points: triangle() }],
      replaceZones: true,
    });
  }, 30_000);

  it('editor state payload > rejects a spawn coordinate that is not finite', async () => {
    await expectRejectedEditor('{"spawn":{"x":1e309,"y":0}}');
  }, 30_000);

  it('editor state payload > rejects an unknown zone type', async () => {
    await expectRejectedEditor({
      zones: [{ name: 'Secret', type: 'private', points: triangle() }],
      replaceZones: true,
    });
  }, 30_000);
});

describe('accepted payloads', () => {
  it('accepted payloads > accepts the closed edges of the map', async () => {
    expect(await land(INTERIOR_X, INTERIOR_Y, 'down')).toBe(true);
    await elapsed(MOVE_GAP_MS);
    moveBag.length = 0;
    const before = await rejectionCount('move', 'bounds');
    expect(await land(0, 0, 'left')).toBe(true);
    await elapsed(MOVE_GAP_MS);
    expect(await land(MAP_WIDTH, MAP_HEIGHT, 'right')).toBe(true);
    expect(moveBag.length).toBeGreaterThan(0);
    expect((await rejectionCount('move', 'bounds')) - before).toBe(0);
  }, 30_000);

  it('accepted payloads > accepts every move direction', async () => {
    const before = await rejectionCount('move', 'schema');
    const directions: Direction[] = ['up', 'down', 'left', 'right'];
    for (const direction of directions) {
      await elapsed(MOVE_GAP_MS);
      expect(await land(INTERIOR_X, INTERIOR_Y, direction)).toBe(true);
    }
    expect((await rejectionCount('move', 'schema')) - before).toBe(0);
  }, 30_000);

  it('accepted payloads > accepts both dnd values', async () => {
    const room = actor;
    if (!room) throw new Error('world client is not connected');
    const before = await rejectionCount('dnd_status', 'schema');
    for (const dnd of [true, false]) {
      dndBag.length = 0;
      room.send('dnd_status', { dnd });
      const heard = await waitUntil(() => {
        const pose = poseOf(room);
        return pose !== null && pose.dnd === dnd && dndBag.length > 0;
      }, 1_500);
      expect(heard).toBe(true);
    }
    expect((await rejectionCount('dnd_status', 'schema')) - before).toBe(0);
  }, 30_000);

  it('accepted payloads > accepts a signed zero and a tiny finite coordinate', async () => {
    const before = await rejectionCount('move', 'schema');
    expect(await land(-0, Number.MIN_VALUE, 'up')).toBe(true);
    expect(actor?.sessionId).toBeTruthy();
    expect((await rejectionCount('move', 'schema')) - before).toBe(0);
  }, 30_000);

  it('accepted payloads > accepts the current tileset shape', async () => {
    await expectAcceptedEditor({ tilesets: [KNOWN_TILESET] });
    expect(await tilesetCount()).toBe(1);
  }, 30_000);

  it('accepted payloads > accepts a portal zone', async () => {
    await expectAcceptedEditor({
      zones: [
        {
          name: 'Door',
          type: 'portal',
          points: triangle(),
          portalTarget: 'office',
          portalSpawnX: 8,
          portalSpawnY: 8,
        },
      ],
      replaceZones: true,
    });
    const zone = await prisma.zone.findFirst({ where: { mapId, name: 'Door' } });
    expect(zone?.type).toBe('portal');
    expect(zone?.portalTarget).toBe('office');
    expect(zone?.portalSpawnX).toBe(8);
    expect(zone?.portalSpawnY).toBe(8);
  }, 30_000);

  it('accepted payloads > accepts every stored polygon shape', async () => {
    const shape = triangle();
    const variants = [
      { name: 'ByPoints', points: shape },
      { name: 'ByList', polygon: shape },
      { name: 'ByObject', polygon: { points: shape } },
    ];
    for (const zone of variants) {
      await expectAcceptedEditor({ zones: [zone], replaceZones: true });
      const row = await prisma.zone.findFirst({ where: { mapId, name: zone.name } });
      expect(Array.isArray(row?.polygon) ? row.polygon.length : 0).toBe(3);
    }
  }, 30_000);

  it('accepted payloads > clears zones when the zone list is empty', async () => {
    await resetEditor();
    await expectAcceptedEditor({ zones: [], replaceZones: true });
    expect(await prisma.zone.count({ where: { mapId } })).toBe(0);
  }, 30_000);

  it('accepted payloads > stores zones returned with an id and a null capacity', async () => {
    await expectAcceptedEditor({ zones: [{ name: 'Round', points: triangle() }], replaceZones: true });
    const fetched = await getEditor();
    const zones =
      typeof fetched === 'object' && fetched !== null && 'zones' in fetched && Array.isArray(fetched.zones)
        ? fetched.zones
        : [];
    expect(zones).toHaveLength(1);
    const zone: unknown = zones[0];
    const roundTrip =
      typeof zone === 'object' &&
      zone !== null &&
      'id' in zone &&
      'capacity' in zone &&
      'name' in zone &&
      typeof zone.id === 'string' &&
      zone.id.length > 0 &&
      zone.capacity === null &&
      zone.name === 'Round';
    expect(roundTrip).toBe(true);
    await expectAcceptedEditor({ zones, replaceZones: true });
    const stored = await prisma.zone.findMany({ where: { mapId } });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe('Round');
    expect(stored[0]?.capacity).toBeNull();
  }, 30_000);

  it('accepted payloads > accepts 256 tilesets', async () => {
    await expectAcceptedEditor({ tilesets: tilesetList(256) });
    expect(await tilesetCount()).toBe(256);
  }, 30_000);

  it('accepted payloads > accepts 512 zones', async () => {
    await expectAcceptedEditor({ zones: zoneList(512), replaceZones: true });
    expect(await prisma.zone.count({ where: { mapId } })).toBe(512);
  }, 60_000);

  it('accepted payloads > accepts a polygon of 2048 points', async () => {
    await expectAcceptedEditor({ zones: [{ name: 'Outline', points: points(2048) }], replaceZones: true });
    const row = await prisma.zone.findFirst({ where: { mapId, name: 'Outline' } });
    expect(Array.isArray(row?.polygon) ? row.polygon.length : 0).toBe(2048);
  }, 30_000);
});
