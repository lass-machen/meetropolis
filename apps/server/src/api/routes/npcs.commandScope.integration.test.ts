/**
 * An NPC command reaches only the world rooms of the NPC's own tenant.
 *
 * A real Colyseus server with the real `WorldRoom` (see
 * testUtils/matchmakeHarness.ts), a real PostgreSQL database (db.js is NOT
 * mocked), the real HTTP API (cookieParser, the tenant middleware and
 * registerApi, as in the world access security test) and real
 * @colyseus/sdk clients. A member of the NPC's tenant and a member of a
 * second tenant each hold a seat in the room of their own tenant. The
 * command must arrive in the first room and never in the second.
 */

import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import { createPrismaClient } from '../../db.js';
import { registerApi } from '../../api.js';
import { tenantMiddleware } from '../../tenancy.js';
import { cleanupTenants, seedMember, seedTenant } from '../../testUtils/worldSeed.js';
import {
  disposeAllRooms,
  startMatchmakeServer,
  stopMatchmakeServer,
  type MatchmakeTestServer,
} from '../../testUtils/matchmakeHarness.js';

if (!process.env.DATABASE_URL) {
  throw new Error('npcs.commandScope.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const FILE = 'npcs.commandScope.integration.test.ts';

// The HTTP API runs single-tenant here, so the NPC's tenant is the default one.
process.env.DEFAULT_TENANT_SLUG = `npcc-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

const prisma = createPrismaClient();
const packUuids: string[] = [];
let server: MatchmakeTestServer;
let ownTenant = { id: '', slug: '' };
let otherTenant = { id: '', slug: '' };
let fixturePackUuid = '';

interface TrackedSeat {
  room: Room;
  commands: unknown[];
}

/** One global avatar pack so a member join runs to completion (real row, not a mock). */
async function seedGlobalAvatarPack(): Promise<void> {
  const uuid = `npcc-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await prisma.avatarPack.create({
    data: {
      uuid,
      name: uuid,
      description: 'npc command scope fixture',
      author: 'npcc-fixture',
      version: '1',
      avatars: [{ key: 'business_man' }],
      tenantId: null,
    },
  });
  packUuids.push(uuid);
  fixturePackUuid = uuid;
}

/** Join the room of `tenantSlug` and record every npc_command the client receives. */
async function takeSeat(token: string, tenantSlug: string): Promise<TrackedSeat> {
  const client = new Client(server.base);
  client.auth.token = token;
  const room = await client.joinOrCreate('world', {
    tenant: tenantSlug,
    avatarId: `${fixturePackUuid}:business_man`,
    zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
  });
  const seat: TrackedSeat = { room, commands: [] };
  room.onMessage('npc_command', (message: unknown) => {
    seat.commands.push(message);
  });
  return seat;
}

/** Real waiting with polling on the condition, never a fixed sleep as proof. */
async function waitForCommands(seat: TrackedSeat, timeoutMs: number): Promise<unknown[]> {
  const deadline = Date.now() + timeoutMs;
  while (seat.commands.length === 0 && Date.now() <= deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return seat.commands;
}

/** Cleanup-only leave: never fail the test, never hang on a swept room. */
async function leaveQuietly(seat: TrackedSeat | undefined): Promise<void> {
  if (!seat) return;
  await Promise.race([seat.room.leave().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 3_000))]);
}

function configureApi(app: express.Express): void {
  app.use(cookieParser());
  app.use(express.json());
  app.use(tenantMiddleware as unknown as express.RequestHandler);
  // Async wiring without awaits before listen: the first API request arrives
  // long after this resolves, so the table is complete by then.
  void registerApi(app);
}

beforeAll(async () => {
  ownTenant = await seedTenant(prisma, { slug: process.env.DEFAULT_TENANT_SLUG as string });
  otherTenant = await seedTenant(prisma);
  await seedGlobalAvatarPack();
  await prisma.map.create({ data: { tenantId: ownTenant.id, name: 'office', meta: {} } });
  await prisma.map.create({ data: { tenantId: otherTenant.id, name: 'office', meta: {} } });
  server = await startMatchmakeServer({ configureApp: configureApi });
});

beforeEach(async () => {
  await disposeAllRooms();
});

afterAll(async () => {
  await stopMatchmakeServer(server);
  const tenantIds = [ownTenant.id, otherTenant.id];
  await prisma.presence.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.room.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.npc.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.map.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.avatarPack.deleteMany({ where: { uuid: { in: packUuids } } });
  await cleanupTenants(prisma, tenantIds);
  await prisma.$disconnect();
});

describe('npc command scope', () => {
  it('delivers a command to the rooms of its tenant and never to a room of another tenant', async () => {
    const owner = await seedMember(prisma, ownTenant.id);
    const stranger = await seedMember(prisma, otherTenant.id);
    // The same identity in both tenants: identities are unique per tenant only.
    const identity = `npcc-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const npc = await prisma.npc.create({ data: { tenantId: ownTenant.id, identity, name: identity } });
    await prisma.npc.create({ data: { tenantId: otherTenant.id, identity, name: identity } });

    let ownSeat: TrackedSeat | undefined;
    let otherSeat: TrackedSeat | undefined;
    try {
      ownSeat = await takeSeat(owner.token, ownTenant.slug);
      otherSeat = await takeSeat(stranger.token, otherTenant.slug);
      expect(ownSeat.room.roomId, 'each tenant must have a room of its own').not.toBe(otherSeat.room.roomId);

      const res = await fetch(`${server.base}/npcs/${npc.id}/command`, {
        method: 'POST',
        headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'move', payload: { x: 120, y: 80 } }),
      });
      expect(res.status, `${FILE} the command route must accept the member`).toBe(200);
      expect(await res.json()).toEqual({ ok: true, delivered: 1 });

      const received = await waitForCommands(ownSeat, 5_000);
      expect(received, 'the room of the NPC tenant must receive the command').toEqual([
        { npcIdentity: identity, action: 'move', payload: { x: 120, y: 80 } },
      ]);
      // Both rooms are served by the same synchronous loop, so the other
      // room's delivery would already be in flight; poll it with the same deadline.
      const leaked = await waitForCommands(otherSeat, 2_000);
      expect(leaked, 'a room of another tenant must receive nothing').toEqual([]);
    } finally {
      await leaveQuietly(ownSeat);
      await leaveQuietly(otherSeat);
    }
  }, 30_000);
});
