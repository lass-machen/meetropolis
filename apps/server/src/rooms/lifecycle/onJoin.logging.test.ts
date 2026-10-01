/**
 * Logging of the join path itself (after onAuth): a staged-mode join that
 * carries a client-supplied identity must not make the reconnect, takeover,
 * ghost-cleanup or completion log lines grow with that identity.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../logger.js', () => ({ logger: log }));
vi.mock('../../metrics.js', () => ({ colyseusPlayers: { inc: vi.fn(), dec: vi.fn() } }));
vi.mock('../utils/broadcastHelpers.js', () => ({ broadcastToMap: vi.fn() }));

vi.mock('./onJoin.limiter.js', () => ({
  enforceOssLimit: vi.fn(() => Promise.resolve(false)),
  enforceTenantLimits: vi.fn(() => Promise.resolve(false)),
}));
vi.mock('./onJoin.completion.js', () => ({ completePendingJoin: vi.fn(() => Promise.resolve()) }));

import { performOnJoin } from './onJoin.js';
import { findExistingSession } from './ghostDetection.js';
import { takeOverExistingSessions } from '../handlers/sessionHandlers.js';
import type { WorldRoom, Player as PlayerCtor } from '../WorldRoom.js';

type OnJoinClient = Parameters<typeof performOnJoin>[2];

const HUGE = 'x'.repeat(900_000);
const LOG_BUDGET_CHARS = 1_000;

/** Everything the logger received, as one string. */
function logged(): string {
  return JSON.stringify([log.debug, log.info, log.warn, log.error].flatMap((fn) => fn.mock.calls));
}

function roomHolding(identity: string): WorldRoom {
  return {
    state: { players: new Map([['old-sid', { identity, mapId: 'map-a' }]]) },
    lastSeen: new Map<string, number>(),
    pendingLeaves: new Map<string, ReturnType<typeof setTimeout>>(),
    playerTenantKey: new Map<string, string>(),
    clients: [],
    broadcast: vi.fn(),
  } as unknown as WorldRoom;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('join path logs stay bounded for a long identity', () => {
  it('when a pending leave is cancelled on reconnect', async () => {
    const room = roomHolding(HUGE);
    room.pendingLeaves.set(
      'old-sid',
      setTimeout(() => undefined, 60_000),
    );
    const client = { sessionId: 'new-sid', auth: { identity: HUGE, isNpc: false, zonePrivacyVersion: 0 } };

    await performOnJoin(
      room,
      new Set<WorldRoom>([room]),
      client as unknown as OnJoinClient,
      {},
      class {} as unknown as typeof PlayerCtor,
    );

    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('Graceful reconnect'),
      expect.stringContaining('(900000 chars)'),
      'oldSid:',
      'old-sid',
    );
    expect(logged().length).toBeLessThan(LOG_BUDGET_CHARS);
  });

  it('when a ghost session is cleaned up', () => {
    const room = roomHolding(HUGE);

    expect(findExistingSession(new Set<WorldRoom>([room]), 60_000, HUGE)).toBeNull();

    expect(log.info).toHaveBeenCalled();
    expect(logged().length).toBeLessThan(LOG_BUDGET_CHARS);
  });

  it('when an existing session is taken over', () => {
    const room = roomHolding(HUGE);

    takeOverExistingSessions(new Set<WorldRoom>([room]), HUGE, 'new-sid');

    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('Session taken over'),
      expect.stringContaining('(900000 chars)'),
      'oldSid:',
      'old-sid',
      'newSid:',
      'new-sid',
    );
    expect(logged().length).toBeLessThan(LOG_BUDGET_CHARS);
  });

  it('keeps an ordinary identity readable in the takeover line', () => {
    takeOverExistingSessions(new Set<WorldRoom>([roomHolding('user-1')]), 'user-1', 'new-sid');

    expect(logged()).toContain('user-1');
  });
});
