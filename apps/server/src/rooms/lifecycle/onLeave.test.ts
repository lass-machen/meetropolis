/**
 * Finding 5: the presence write on leave must be scoped by the JWT-verified
 * auth.tenantId, never by room.metadata.tenant. In a shared apex/'default' room
 * the room slug is 'default', which is NOT the leaving player's real tenant, so
 * scoping by it would persist the position under the wrong tenant (and stay
 * inconsistent with the join-path PII scoping). Falls back to the room slug only
 * for a token-less / NPC leave with no verified tenant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../metrics.js', () => ({ colyseusPlayers: { inc: vi.fn(), dec: vi.fn() } }));
vi.mock('../utils/broadcastHelpers.js', () => ({ broadcastToMap: vi.fn() }));
vi.mock('../utils/bubbleHelpers.js', () => ({ broadcastBubbleState: vi.fn() }));
vi.mock('../handlers/zoneLockHandler.js', () => ({ onPlayerLeaveZoneLock: vi.fn() }));
vi.mock('../audioZones/runtime.js', () => ({ trackLeave: vi.fn() }));

import { performOnLeave } from './onLeave.js';
import type { WorldRoom } from '../WorldRoom.js';
import type { Client } from 'colyseus';

const presenceUpdateMany = vi.fn(() => Promise.resolve({ count: 1 }));
const tenantFindUnique = vi.fn(() => Promise.resolve({ id: 'from-slug' }));
const fakePrisma = {
  presence: { updateMany: presenceUpdateMany },
  tenant: { findUnique: tenantFindUnique },
};

function makeRoom(): WorldRoom {
  const players = new Map<string, unknown>();
  players.set('sid-1', {
    id: 'sid-1',
    identity: 'user-a',
    x: 12.6,
    y: 7.2,
    direction: 'down',
    mapName: 'office',
    mapId: 'm1',
  });
  return {
    state: { players },
    prismaForPresence: fakePrisma,
    // Shared-room slug that is deliberately NOT the leaving player's real tenant.
    metadata: { tenant: 'default' },
    pendingLeaves: new Map(),
    lastSeen: new Map(),
    playerTenantKey: new Map(),
    bubbleGroups: {},
    zoneLockState: { locks: new Map() },
    // Large grace so the commit timer never fires during the synchronous asserts.
    leaveGraceMs: 100000,
  } as unknown as WorldRoom;
}

beforeEach(() => {
  presenceUpdateMany.mockClear();
  tenantFindUnique.mockClear();
});

describe('performOnLeave: presence scoped by the verified auth tenant (Finding 5)', () => {
  it('writes presence under auth.tenantId, never the shared room-metadata tenant', () => {
    const room = makeRoom();
    const client = {
      sessionId: 'sid-1',
      auth: { identity: 'user-a', isNpc: false, zonePrivacyVersion: 1, tenantId: 'tid-a' },
    } as unknown as Client;

    performOnLeave(room, client);

    expect(presenceUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-a', tenantId: 'tid-a' }) }),
    );
    // The room slug ('default') was NOT resolved for the write.
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  it('falls back to the room slug for a leave with no verified tenant (NPC / token-less)', () => {
    const room = makeRoom();
    const client = { sessionId: 'sid-1', auth: undefined } as unknown as Client;

    performOnLeave(room, client);

    expect(tenantFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ slug: 'default' }) }),
    );
  });
});
