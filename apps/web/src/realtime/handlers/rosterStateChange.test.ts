import { describe, it, expect, vi } from 'vitest';
import { setupRosterOnStateChange } from './rosterStateChange';
import type { UseWorldRoomArgs } from '../types';

type RosterEntry = { identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string };
type PlayerLike = { x: number; y: number; identity: string; name: string };

type StateChangeCb = (state: unknown) => void;

function makeMockRoom() {
  const cbs: StateChangeCb[] = [];
  return {
    onStateChange: (cb: StateChangeCb) => {
      cbs.push(cb);
    },
    triggerStateChange: (state: unknown) => {
      for (const cb of cbs) cb(state);
    },
  };
}

function makeRef<T>(initial: T) {
  return { current: initial };
}

function makeArgs(overrides?: Partial<UseWorldRoomArgs>): UseWorldRoomArgs {
  return {
    localPosRef: makeRef<{ id: string; x?: number; y?: number }>({ id: 'session-local', x: 0, y: 0 }),
    colyseusToLivekitMap: makeRef<Record<string, string>>({}),
    identityToNameMap: makeRef<Record<string, string>>({}),
    rosterByIdentityRef: makeRef<Record<string, { name: string; x: number; y: number }>>({}),
    setRoster: vi.fn(),
    ...overrides,
  } as unknown as UseWorldRoomArgs;
}

/**
 * Drive one state change and return the roster the handler would produce from
 * `prev`. setRoster is called with an updater, so the updater is captured and
 * applied here.
 */
function runStateChange(
  prev: RosterEntry[],
  players: Array<[string, PlayerLike]>,
  me: { id: string; name?: string; email?: string },
  argsOverrides?: Partial<UseWorldRoomArgs>,
): { roster: RosterEntry[]; args: UseWorldRoomArgs } {
  const room = makeMockRoom();
  let roster = prev;
  const setRoster = (updater: (p: RosterEntry[]) => RosterEntry[]) => {
    roster = updater(roster);
  };
  const args = makeArgs({ setRoster: setRoster as unknown as UseWorldRoomArgs['setRoster'], ...argsOverrides });
  setupRosterOnStateChange(room as unknown as Parameters<typeof setupRosterOnStateChange>[0], args, setRoster, me);
  room.triggerStateChange({ players: new Map<string, PlayerLike>(players) });
  return { roster, args };
}

describe('setupRosterOnStateChange', () => {
  it('never lets a namesake mark another identity online', () => {
    // Same scenario as `features/participants/presence.ts`: an NPC shares its
    // display name with an offline member. The member must stay offline and
    // keep the coordinates the roster panel uses as a jump target, and the NPC
    // must get a row of its own.
    const prev: RosterEntry[] = [{ identity: 'user-1', name: 'Dave', online: false, x: 5, y: 6 }];

    const { roster } = runStateChange(prev, [['session-npc', { x: 99, y: 99, identity: 'npc-dave', name: 'Dave' }]], {
      id: 'local-user',
      name: 'Local User',
    });

    const member = roster.find((r) => r.identity === 'user-1');
    expect(member?.online).toBe(false);
    expect(member?.x).toBe(5);
    expect(member?.y).toBe(6);
    const npc = roster.find((r) => r.identity === 'npc-dave');
    expect(npc?.online).toBe(true);
    expect(npc?.x).toBe(99);
  });

  it('matches an online player to their existing roster row by identity', () => {
    const prev: RosterEntry[] = [{ identity: 'user-1', name: 'Dave', online: false, x: 5, y: 6 }];

    const { roster, args } = runStateChange(prev, [['session-a', { x: 10, y: 20, identity: 'user-1', name: 'Dave' }]], {
      id: 'local-user',
      name: 'Local User',
    });

    expect(roster.filter((r) => r.identity === 'user-1')).toHaveLength(1);
    const member = roster.find((r) => r.identity === 'user-1');
    expect(member?.online).toBe(true);
    expect(member?.x).toBe(10);
    expect(member?.y).toBe(20);
    expect(args.rosterByIdentityRef.current['user-1']).toEqual({ name: 'Dave', x: 10, y: 20 });
  });

  it('skips the local session player and adds the local user under their stable id', () => {
    const { roster } = runStateChange(
      [],
      [['session-local', { x: 1, y: 1, identity: 'local-user', name: 'Local User' }]],
      { id: 'local-user', name: 'Local User' },
      { localPosRef: makeRef<{ id: string; x?: number; y?: number }>({ id: 'session-local', x: 7, y: 8 }) },
    );

    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ identity: 'local-user', online: true, x: 7, y: 8 });
  });
});
