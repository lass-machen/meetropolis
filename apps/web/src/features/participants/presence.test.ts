import { describe, it, expect } from 'vitest';
import { mergeRecentPresence, type ApiPresence, type RosterItem } from './presence';

describe('mergeRecentPresence', () => {
  it('merges api presence with online map and sorts by online then name', () => {
    const prev: RosterItem[] = [
      { identity: 'u1', name: 'Alice', online: false },
      { identity: 'u2', name: 'Bob', online: true, x: 1, y: 2 },
    ];
    const online = {
      u3: { name: 'Carol', x: 3, y: 4 },
      u2: { name: 'Bob', x: 10, y: 20 },
    } as const;
    const api: ApiPresence[] = [
      { userId: 'u1', user: { name: 'Alice' }, updatedAt: '2024-01-01T00:00:00Z' },
      { userId: 'u3', user: { name: 'Carol' }, updatedAt: '2024-01-02T00:00:00Z' },
    ];

    const out = mergeRecentPresence(prev, online, api);
    expect(out[0].identity).toBe('u2');
    expect(out[0].online).toBe(true);
    expect(out[1].identity).toBe('u3');
    expect(out[1].online).toBe(true);
    expect(out.some((x) => x.identity === 'u1')).toBe(true);
  });

  it('never lets a namesake mark another identity online', () => {
    // An NPC is in the online map under `npc-*` and shares its display name
    // with a roster member. The member is offline and must stay offline, keep
    // their own coordinates (the roster panel uses them as a jump target), and
    // the NPC must get a row of its own instead of adopting theirs.
    const prev: RosterItem[] = [{ identity: 'user-1', name: 'Dave', online: false, x: 5, y: 6 }];
    const online = { 'npc-dave': { name: 'Dave', x: 99, y: 99 } } as const;
    const api: ApiPresence[] = [];

    const out = mergeRecentPresence(prev, online, api);

    const member = out.find((x) => x.identity === 'user-1');
    expect(member?.online).toBe(false);
    expect(member?.x).toBe(5);
    expect(member?.y).toBe(6);
    const npc = out.find((x) => x.identity === 'npc-dave');
    expect(npc?.online).toBe(true);
    expect(npc?.x).toBe(99);
  });
});
