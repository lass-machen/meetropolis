import { describe, it, expect } from 'vitest';
import { buildTrackPermissions } from './zonePermissions';

describe('buildTrackPermissions', () => {
  it('grants all tracks of each allowed identity (allowAll is required or the SFU denies)', () => {
    expect(buildTrackPermissions(['alice', 'bob'])).toEqual([
      { participantIdentity: 'alice', allowAll: true },
      { participantIdentity: 'bob', allowAll: true },
    ]);
  });

  it('returns an empty list for an empty allow-list (deny-all)', () => {
    expect(buildTrackPermissions([])).toEqual([]);
  });
});
