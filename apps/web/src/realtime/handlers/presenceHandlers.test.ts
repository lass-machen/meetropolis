import { describe, it, expect } from 'vitest';
import { createRosterRefresher } from './presenceHandlers';
import type { RosterItem } from '../../features/participants/presence';
import type { UseWorldRoomArgs } from '../types';

function makeRef<T>(initial: T) {
  return { current: initial };
}

/**
 * Build the refresher over a captured roster so the updater it hands to
 * setRoster can be applied and inspected.
 */
function runRefresher(
  prev: RosterItem[],
  overrides: Partial<UseWorldRoomArgs>,
): { roster: RosterItem[]; args: UseWorldRoomArgs } {
  let roster = prev;
  const setRoster = (updater: (p: RosterItem[]) => RosterItem[]) => {
    roster = updater(roster);
  };
  const args = {
    me: null,
    localPosRef: makeRef<{ id: string; x?: number; y?: number }>({ id: 'session-local', x: 0, y: 0 }),
    remotesRef: makeRef<Record<string, { x: number; y: number }>>({}),
    colyseusToLivekitMap: makeRef<Record<string, string>>({}),
    identityToNameMap: makeRef<Record<string, string>>({}),
    rosterByIdentityRef: makeRef<Record<string, { name: string; x: number; y: number }>>({}),
    ...overrides,
    // setRoster is set last so the updater stays observable.
    setRoster,
  } as unknown as UseWorldRoomArgs;

  createRosterRefresher(args)();
  return { roster, args };
}

describe('createRosterRefresher', () => {
  it('never lets a namesake mark another identity online', () => {
    // Same scenario as `rosterStateChange.ts` and
    // `features/participants/presence.ts`: an NPC shares its display name with
    // an offline member. The member keeps their offline state and their
    // coordinates, the NPC gets a row of its own.
    const prev: RosterItem[] = [{ identity: 'user-1', name: 'Dave', online: false, x: 5, y: 6 }];

    const { roster } = runRefresher(prev, {
      remotesRef: makeRef<Record<string, { x: number; y: number }>>({ 'session-npc': { x: 99, y: 99 } }),
      colyseusToLivekitMap: makeRef<Record<string, string>>({ 'session-npc': 'npc-dave' }),
      identityToNameMap: makeRef<Record<string, string>>({ 'npc-dave': 'Dave' }),
    });

    const member = roster.find((r) => r.identity === 'user-1');
    expect(member?.online).toBe(false);
    expect(member?.x).toBe(5);
    expect(member?.y).toBe(6);
    const npc = roster.find((r) => r.identity === 'npc-dave');
    expect(npc?.online).toBe(true);
    expect(npc?.x).toBe(99);
  });

  it('matches a remote to their existing roster row by identity', () => {
    const prev: RosterItem[] = [{ identity: 'user-1', name: 'Dave', online: false, x: 5, y: 6 }];

    const { roster, args } = runRefresher(prev, {
      remotesRef: makeRef<Record<string, { x: number; y: number }>>({ 'session-a': { x: 10, y: 20 } }),
      colyseusToLivekitMap: makeRef<Record<string, string>>({ 'session-a': 'user-1' }),
      identityToNameMap: makeRef<Record<string, string>>({ 'user-1': 'Dave' }),
    });

    expect(roster.filter((r) => r.identity === 'user-1')).toHaveLength(1);
    expect(roster[0]).toMatchObject({ identity: 'user-1', online: true, x: 10, y: 20 });
    expect(args.rosterByIdentityRef.current['user-1']).toEqual({ name: 'Dave', x: 10, y: 20 });
  });

  it('adds the local user under their stable user id', () => {
    const { roster } = runRefresher([], {
      me: { id: 'local-user', email: 'local@example.com', name: 'Local User' },
      localPosRef: makeRef<{ id: string; x?: number; y?: number }>({ id: 'session-local', x: 7, y: 8 }),
    });

    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ identity: 'local-user', name: 'Local User', online: true, x: 7, y: 8 });
  });
});
