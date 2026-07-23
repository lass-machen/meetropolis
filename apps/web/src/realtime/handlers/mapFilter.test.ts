import { describe, it, expect } from 'vitest';
import { passesMapFilter } from './mapFilter';

describe('passesMapFilter', () => {
  it('allows players through when currentMap is empty', () => {
    expect(passesMapFilter('office', '')).toBe(true);
    expect(passesMapFilter('office', undefined as any)).toBe(true);
    expect(passesMapFilter('office', null as any)).toBe(true);
  });

  it('allows players through when playerMapName is empty', () => {
    expect(passesMapFilter('', 'office')).toBe(true);
    expect(passesMapFilter(undefined, 'office')).toBe(true);
    expect(passesMapFilter(null as any, 'office')).toBe(true);
  });

  it('allows players through when both are empty', () => {
    expect(passesMapFilter('', '')).toBe(true);
    expect(passesMapFilter(undefined, undefined as any)).toBe(true);
  });

  it('accepts players on the same map', () => {
    expect(passesMapFilter('office', 'office')).toBe(true);
  });

  it('rejects players on a different map', () => {
    expect(passesMapFilter('lounge', 'office')).toBe(false);
    expect(passesMapFilter('office', 'lounge')).toBe(false);
  });
});
