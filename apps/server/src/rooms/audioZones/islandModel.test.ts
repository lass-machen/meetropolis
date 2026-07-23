import { describe, it, expect } from 'vitest';
import {
  islandOf,
  isZoneIsland,
  isolatedIslandFor,
  membersOfIsland,
  allowListFor,
  computeAffectedIdentities,
} from './islandModel.js';

describe('islandOf', () => {
  it('builds a zone island id from mapId + zoneName', () => {
    expect(islandOf('map-1', 'kitchen')).toBe('map-1:zone:kitchen');
  });

  it('builds the open-world island id when no zone applies', () => {
    expect(islandOf('map-1', null)).toBe('map-1:open');
  });
});

describe('isZoneIsland', () => {
  it('recognizes a zone island', () => {
    expect(isZoneIsland('map-1:zone:kitchen')).toBe(true);
  });

  it('does not treat the open island as a zone', () => {
    expect(isZoneIsland('map-1:open')).toBe(false);
  });

  it('does not treat an isolated sentinel as a zone', () => {
    expect(isZoneIsland(isolatedIslandFor('user-1'))).toBe(false);
  });
});

describe('isolatedIslandFor', () => {
  it('is unique per identity', () => {
    expect(isolatedIslandFor('a')).not.toBe(isolatedIslandFor('b'));
  });
});

describe('membersOfIsland / allowListFor', () => {
  const snapshot = new Map<string, string>([
    ['alice', 'map-1:zone:kitchen'],
    ['bob', 'map-1:zone:kitchen'],
    ['carol', 'map-1:open'],
    ['dave', 'map-1:zone:lounge'],
  ]);

  it('lists every identity sharing an island', () => {
    expect(membersOfIsland('map-1:zone:kitchen', snapshot).sort()).toEqual(['alice', 'bob']);
  });

  it('returns an empty list for an island with no members', () => {
    expect(membersOfIsland('map-1:zone:nowhere', snapshot)).toEqual([]);
  });

  it('excludes the identity itself from its own allow-list', () => {
    expect(allowListFor('alice', snapshot)).toEqual(['bob']);
  });

  it('returns an empty allow-list for an untracked identity', () => {
    expect(allowListFor('ghost', snapshot)).toEqual([]);
  });

  it('returns an empty allow-list when the identity is alone in its island', () => {
    expect(allowListFor('dave', snapshot)).toEqual([]);
  });

  it('treats an npc-* identity exactly like any human identity sharing the zone', () => {
    const withNpc = new Map(snapshot).set('npc-receptionist', 'map-1:zone:kitchen');
    expect(allowListFor('npc-receptionist', withNpc).sort()).toEqual(['alice', 'bob']);
    expect(allowListFor('alice', withNpc).sort()).toEqual(['bob', 'npc-receptionist']);
  });
});

describe('computeAffectedIdentities', () => {
  it('includes the mover, the old island (pre-move), and the new island (post-move)', () => {
    const before = new Map([
      ['alice', 'map-1:zone:kitchen'],
      ['bob', 'map-1:zone:kitchen'],
      ['carol', 'map-1:zone:lounge'],
    ]);
    const after = new Map([
      ['alice', 'map-1:zone:lounge'],
      ['bob', 'map-1:zone:kitchen'],
      ['carol', 'map-1:zone:lounge'],
    ]);
    const affected = computeAffectedIdentities('alice', 'map-1:zone:kitchen', 'map-1:zone:lounge', before, after);
    expect([...affected].sort()).toEqual(['alice', 'bob', 'carol']);
  });

  it('handles a fresh join (no old island) without crashing', () => {
    const after = new Map([['alice', 'map-1:open']]);
    const affected = computeAffectedIdentities('alice', null, 'map-1:open', new Map(), after);
    expect([...affected]).toEqual(['alice']);
  });
});
