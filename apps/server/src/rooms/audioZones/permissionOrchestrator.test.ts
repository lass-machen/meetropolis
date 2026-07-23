import { describe, it, expect } from 'vitest';
import { buildPushPayloads } from './permissionOrchestrator.js';

describe('buildPushPayloads', () => {
  it('computes one payload per identity, with the allow-list excluding itself', () => {
    const snapshot = new Map([
      ['alice', 'map-1:zone:kitchen'],
      ['bob', 'map-1:zone:kitchen'],
      ['carol', 'map-1:open'],
    ]);
    const payloads = buildPushPayloads(['alice', 'bob'], snapshot);
    expect(payloads).toEqual([
      { identity: 'alice', islandId: 'map-1:zone:kitchen', allow: ['bob'] },
      { identity: 'bob', islandId: 'map-1:zone:kitchen', allow: ['alice'] },
    ]);
  });

  it('skips an identity that has already departed the snapshot', () => {
    const snapshot = new Map([['alice', 'map-1:open']]);
    const payloads = buildPushPayloads(['alice', 'departed'], snapshot);
    expect(payloads).toEqual([{ identity: 'alice', islandId: 'map-1:open', allow: [] }]);
  });

  it('deduplicates naturally when the same identity is affected twice (Set semantics upstream)', () => {
    const snapshot = new Map([['alice', 'map-1:open']]);
    const payloads = buildPushPayloads(new Set(['alice', 'alice']), snapshot);
    expect(payloads).toHaveLength(1);
  });
});
