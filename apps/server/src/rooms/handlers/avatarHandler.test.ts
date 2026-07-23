/**
 * Tests for the avatar_change handler's gating: it must validate the avatarId
 * before broadcasting, trust NPCs for non-custom ids, and never broadcast an
 * unvalidated (or foreign) custom avatar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client } from 'colyseus';
import type { PrismaClient } from '../../generated/prisma/index.js';
import type { WorldRoom } from '../WorldRoom.js';

const broadcastToMap = vi.fn();
vi.mock('../utils/broadcastHelpers.js', () => ({ broadcastToMap: (...args: unknown[]) => broadcastToMap(...args) }));

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
  return { sessionId: 'sess-1', auth } as unknown as Client;
}

const TENANT_MINE = 'tenant-mine';
const TENANT_FOREIGN = 'tenant-foreign';

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
    avatarPack: { findUnique: vi.fn(() => Promise.resolve(null)) },
  } as unknown as PrismaClient;
}

// `tenantId` is the JWT-verified tenant of the world join (onAuth.ts) — it is
// what turns into the pack/custom-avatar scope, never a client-supplied value.
const user = { identity: 'me', isNpc: false, zonePrivacyVersion: 0, tenantId: TENANT_MINE };
const npc = { identity: 'npc-1', isNpc: true, zonePrivacyVersion: 0, tenantId: TENANT_MINE };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('handleAvatarChange', () => {
  beforeEach(() => broadcastToMap.mockClear());

  it('ignores a change with no verified auth', () => {
    const player = { avatarId: 'a', mapId: 'm' };
    handleAvatarChange(makeRoom(player, prismaWithCustom({})), makeClient(null), {
      avatarId: 'default-characters:suit_man',
    });
    expect(broadcastToMap).not.toHaveBeenCalled();
    expect(player.avatarId).toBe('a');
  });

  it('trusts an NPC for a non-custom id but not for a custom id', () => {
    const p1 = { avatarId: 'a', mapId: 'm' };
    handleAvatarChange(makeRoom(p1, null), makeClient(npc), { avatarId: 'default-characters:suit_man' });
    expect(p1.avatarId).toBe('default-characters:suit_man');
    expect(broadcastToMap).toHaveBeenCalledTimes(1);

    broadcastToMap.mockClear();
    const p2 = { avatarId: 'a', mapId: 'm' };
    handleAvatarChange(makeRoom(p2, null), makeClient(npc), { avatarId: 'custom:x' });
    expect(p2.avatarId).toBe('a');
    expect(broadcastToMap).not.toHaveBeenCalled();
  });

  const CUSTOM_AVATARS = { mine: TENANT_MINE, theirs: TENANT_FOREIGN, unattributed: null };

  it('broadcasts an existing custom avatar of the own tenant', async () => {
    const own = { avatarId: 'a', mapId: 'm' };
    handleAvatarChange(makeRoom(own, prismaWithCustom(CUSTOM_AVATARS)), makeClient(user), {
      avatarId: 'custom:mine',
    });
    await flush();
    expect(own.avatarId).toBe('custom:mine');
    expect(broadcastToMap).toHaveBeenCalledTimes(1);
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

  it('with no prisma, allows a non-custom id but rejects a custom id', () => {
    const p1 = { avatarId: 'a', mapId: 'm' };
    handleAvatarChange(makeRoom(p1, null), makeClient(user), { avatarId: 'default-characters:suit_man' });
    expect(p1.avatarId).toBe('default-characters:suit_man');

    const p2 = { avatarId: 'a', mapId: 'm' };
    handleAvatarChange(makeRoom(p2, null), makeClient(user), { avatarId: 'custom:x' });
    expect(p2.avatarId).toBe('a');
  });
});
