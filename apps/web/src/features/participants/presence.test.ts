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

    const out = mergeRecentPresence(prev, online as any, api);
    expect(out[0].identity).toBe('u2');
    expect(out[0].online).toBe(true);
    expect(out[1].identity).toBe('u3');
    expect(out[1].online).toBe(true);
    expect(out.some(x => x.identity === 'u1')).toBe(true);
  });

  it('matches online entries by name if identity differs', () => {
    const prev: RosterItem[] = [ { identity: 'legacy-1', name: 'Dave', online: false } ];
    const online = { x1: { name: 'Dave', x: 0, y: 0 } } as const;
    const api: ApiPresence[] = [];
    const out = mergeRecentPresence(prev, online as any, api);
    const d = out.find(x => x.name === 'Dave');
    expect(d?.online).toBe(true);
  });
});


