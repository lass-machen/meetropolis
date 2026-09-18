/**
 * Tests for the avatar_change handler's gating: it must validate the avatarId
 * before broadcasting, trust NPCs for non-custom ids, and never broadcast an
 * unvalidated (or foreign) custom avatar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client } from 'colyseus';
import type { PrismaClient } from '../../generated/prisma/index.js';
import type { WorldRoom } from '../WorldRoom.js';
import {
  ENTERPRISE_PACK_RESOLVER_STATES,
  type EnterprisePackResolverState,
} from '../../testUtils/enterprisePackResolverStates.js';

const broadcastToMap = vi.fn();
const tenancy = vi.hoisted(() => ({ enabled: false, resolver: vi.fn() }));
vi.mock('../utils/broadcastHelpers.js', () => ({ broadcastToMap: (...args: unknown[]) => broadcastToMap(...args) }));

vi.mock('../../tenancyLoader.js', () => ({
  getTenancyModule: () =>
    Promise.resolve(
      tenancy.enabled
        ? { version: 1, isMultiTenantEnabled: () => true, resolveAdditionalPackUuids: tenancy.resolver }
        : { version: 1, isMultiTenantEnabled: () => false },
    ),
}));

import { handleAvatarChange } from './avatarHandler.js';

interface Player {
  avatarId: string;
  mapId: string;
}

function makeRoom(player: Player | null, prisma: PrismaClient | null): WorldRoom {
  const players = new Map<string, Player>();
  if (player) players.set('sess-1', player);
  return { state: { players }, prismaForPresence: prisma } as unknown as WorldRoom;
}

function makeClient(auth: unknown): Client {
  return { sessionId: 'sess-1', auth, send: vi.fn() } as Client;
}

const TENANT_MINE = 'tenant-mine';
const TENANT_FOREIGN = 'tenant-foreign';

interface PackWhere {
  uuid?: string | { notIn: string[] };
  tenantId?: string | null;
  OR?: PackWhere[];
  AND?: PackWhere[];
}

const PACKS = [
  { uuid: 'default-characters', tenantId: null, avatars: [{ key: 'business_man' }, { key: 'suit_man' }] },
  { uuid: 'premium', tenantId: null, avatars: [{ key: 'hero' }] },
];

function matchesPackWhere(pack: (typeof PACKS)[number], where: PackWhere): boolean {
  if (typeof where.uuid === 'string' && pack.uuid !== where.uuid) return false;
  if (typeof where.uuid === 'object' && where.uuid.notIn.includes(pack.uuid)) return false;
  if (where.tenantId !== undefined && pack.tenantId !== where.tenantId) return false;
  if (where.OR && !where.OR.some((clause) => matchesPackWhere(pack, clause))) return false;
  if (where.AND && !where.AND.every((clause) => matchesPackWhere(pack, clause))) return false;
  return true;
}

/** Custom avatars keyed by uuid, each with the tenant it was composed in. */
function prismaWithCustom(existing: Record<string, string | null>): PrismaClient {
  return {
    customAvatar: {
      findFirst: vi.fn(({ where }: { where: { uuid: string; tenantId?: string } }) => {
        if (!(where.uuid in existing)) return Promise.resolve(null);
        const owner = existing[where.uuid] ?? null;
        const visible = where.tenantId === undefined || owner === where.tenantId;
        return Promise.resolve(visible ? { uuid: where.uuid } : null);
      }),
    },
    avatarPack: {
      findFirst: vi.fn(({ where }: { where: PackWhere }) =>
        Promise.resolve(PACKS.find((pack) => matchesPackWhere(pack, where)) ?? null),
      ),
    },
    map: { findUnique: vi.fn(() => Promise.resolve({ tenantId: TENANT_MINE })) },
  } as unknown as PrismaClient;
}

// `tenantId` is the JWT-verified tenant of the world join (onAuth.ts) — it is
// what turns into the pack/custom-avatar scope, never a client-supplied value.
const user = { identity: 'me', isNpc: false, zonePrivacyVersion: 0, tenantId: TENANT_MINE };
const npc = { identity: 'npc-1', isNpc: true, zonePrivacyVersion: 0 };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('handleAvatarChange', () => {
  beforeEach(() => {
    broadcastToMap.mockClear();
    tenancy.enabled = false;
    tenancy.resolver.mockReset();
  });

  function configureResolver(state: EnterprisePackResolverState): void {
    tenancy.enabled = state.hook !== 'absent';
    if (state.hook === 'reject') {
      tenancy.resolver.mockRejectedValue(new Error('catalogue unavailable'));
    } else if (state.hook === 'resolve') {
      tenancy.resolver.mockResolvedValue(state.result?.(['premium']));
    }
  }

  it.each(ENTERPRISE_PACK_RESOLVER_STATES)('applies $name to live user and NPC avatar changes', async (state) => {
    configureResolver(state);
    for (const auth of [user, npc]) {
      broadcastToMap.mockClear();
      const player = { avatarId: 'default-characters:business_man', mapId: 'm' };
      const client = makeClient(auth);
      const room = makeRoom(player, prismaWithCustom({}));
      handleAvatarChange(room, client, { avatarId: 'premium:hero' });
      await flush();

      const shouldApply = state.expected === 'accessible';
      expect(player.avatarId).toBe(shouldApply ? 'premium:hero' : 'default-characters:business_man');
      expect(broadcastToMap).toHaveBeenCalledTimes(shouldApply ? 1 : 0);

      broadcastToMap.mockClear();
      const basePlayer = { avatarId: 'a', mapId: 'm' };
      handleAvatarChange(makeRoom(basePlayer, prismaWithCustom({})), makeClient(auth), {
        avatarId: 'default-characters:business_man',
      });
      await flush();
      const baseShouldApply = state.expected !== 'error';
      expect(basePlayer.avatarId).toBe(baseShouldApply ? 'default-characters:business_man' : 'a');
      expect(broadcastToMap).toHaveBeenCalledTimes(baseShouldApply ? 1 : 0);
    }
  });

  it('ignores a change with no verified auth', () => {
    const player = { avatarId: 'a', mapId: 'm' };
    handleAvatarChange(makeRoom(player, prismaWithCustom({})), makeClient(null), {
      avatarId: 'default-characters:suit_man',
    });
    expect(broadcastToMap).not.toHaveBeenCalled();
    expect(player.avatarId).toBe('a');
  });

  it('validates NPC pack ids with the map tenant and rejects custom ids', async () => {
    const p1 = { avatarId: 'a', mapId: 'm' };
    const prisma = prismaWithCustom({});
    handleAvatarChange(makeRoom(p1, prisma), makeClient(npc), {
      avatarId: 'default-characters:suit_man',
    });
    await flush();
    expect(p1.avatarId).toBe('default-characters:suit_man');
    expect(broadcastToMap).toHaveBeenCalledTimes(1);
    expect(prisma.map.findUnique).toHaveBeenCalledWith({ where: { id: 'm' }, select: { tenantId: true } });

    broadcastToMap.mockClear();
    const p2 = { avatarId: 'a', mapId: 'm' };
    handleAvatarChange(makeRoom(p2, prismaWithCustom({ x: TENANT_MINE })), makeClient(npc), { avatarId: 'custom:x' });
    await flush();
    expect(p2.avatarId).toBe('a');
    expect(broadcastToMap).not.toHaveBeenCalled();
  });

  it('rejects an NPC change when its map tenant cannot be resolved', async () => {
    const player = { avatarId: 'a', mapId: 'missing-map' };
    const prisma = prismaWithCustom({});
    vi.mocked(prisma.map.findUnique).mockResolvedValue(null);
    handleAvatarChange(makeRoom(player, prisma), makeClient(npc), { avatarId: 'default-characters:suit_man' });
    await flush();
    expect(player.avatarId).toBe('a');
    expect(broadcastToMap).not.toHaveBeenCalled();
  });

  const CUSTOM_AVATARS = { mine: TENANT_MINE, theirs: TENANT_FOREIGN, unattributed: null };

  it('broadcasts an existing custom avatar of the own tenant', async () => {
    const own = { avatarId: 'a', mapId: 'm' };
    const client = makeClient(user);
    handleAvatarChange(makeRoom(own, prismaWithCustom(CUSTOM_AVATARS)), client, {
      avatarId: 'custom:mine',
    });
    await flush();
    expect(own.avatarId).toBe('custom:mine');
    expect(broadcastToMap).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledWith('avatar_change_accepted', { avatarId: 'custom:mine' });
  });

  it('does NOT broadcast a FOREIGN tenant custom avatar', async () => {
    // Peers in this room could not resolve the manifest anyway (the resolve
    // endpoint is tenant-scoped), so broadcasting it would only advertise that
    // the uuid exists somewhere else.
    const foreign = { avatarId: 'a', mapId: 'm' };
    handleAvatarChange(makeRoom(foreign, prismaWithCustom(CUSTOM_AVATARS)), makeClient(user), {
      avatarId: 'custom:theirs',
    });
    await flush();
    expect(foreign.avatarId).toBe('a');
    expect(broadcastToMap).not.toHaveBeenCalled();
  });

  it('does NOT broadcast a custom avatar without a tenant, nor a non-existent one', async () => {
    for (const avatarId of ['custom:unattributed', 'custom:ghost']) {
      broadcastToMap.mockClear();
      const player = { avatarId: 'a', mapId: 'm' };
      handleAvatarChange(makeRoom(player, prismaWithCustom(CUSTOM_AVATARS)), makeClient(user), { avatarId });
      await flush();
      expect(player.avatarId).toBe('a');
      expect(broadcastToMap).not.toHaveBeenCalled();
    }
  });

  it('does NOT broadcast a custom avatar when the join proved no tenant', async () => {
    // Fail-closed: a join without a verified `tid` collapses to catalog scope,
    // and there is no catalog custom avatar.
    const player = { avatarId: 'a', mapId: 'm' };
    const unbound = { identity: 'me', isNpc: false, zonePrivacyVersion: 0 };
    handleAvatarChange(makeRoom(player, prismaWithCustom(CUSTOM_AVATARS)), makeClient(unbound), {
      avatarId: 'custom:mine',
    });
    await flush();
    expect(player.avatarId).toBe('a');
    expect(broadcastToMap).not.toHaveBeenCalled();
  });

  it('with no prisma, rejects every avatar change', () => {
    const p1 = { avatarId: 'a', mapId: 'm' };
    handleAvatarChange(makeRoom(p1, null), makeClient(user), { avatarId: 'default-characters:suit_man' });
    expect(p1.avatarId).toBe('a');

    const p2 = { avatarId: 'a', mapId: 'm' };
    handleAvatarChange(makeRoom(p2, null), makeClient(user), { avatarId: 'custom:x' });
    expect(p2.avatarId).toBe('a');
  });

  it('does not apply an older validation after a newer change was confirmed', async () => {
    const prisma = prismaWithCustom({});
    const resolvers: Array<(value: { avatars: Array<{ key: string }> }) => void> = [];
    vi.mocked(prisma.avatarPack.findFirst).mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    const player = { avatarId: 'a', mapId: 'm' };
    const client = makeClient(user);
    const room = makeRoom(player, prisma);

    handleAvatarChange(room, client, { avatarId: 'default-characters:suit_man' });
    handleAvatarChange(room, client, { avatarId: 'default-characters:business_man' });
    await flush();
    resolvers[1]?.({ avatars: [{ key: 'business_man' }] });
    await flush();
    resolvers[0]?.({ avatars: [{ key: 'suit_man' }] });
    await flush();

    expect(player.avatarId).toBe('default-characters:business_man');
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledWith('avatar_change_accepted', {
      avatarId: 'default-characters:business_man',
    });
  });
});
