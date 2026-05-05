import { describe, it, expect } from 'vitest';
import { passesMapFilter } from './mapFilter';

describe('passesMapFilter', () => {
  it('laesst Players durch, wenn currentMap leer ist', () => {
    expect(passesMapFilter('office', '')).toBe(true);
    expect(passesMapFilter('office', undefined as any)).toBe(true);
    expect(passesMapFilter('office', null as any)).toBe(true);
  });

  it('laesst Players durch, wenn playerMapName leer ist', () => {
    expect(passesMapFilter('', 'office')).toBe(true);
    expect(passesMapFilter(undefined, 'office')).toBe(true);
    expect(passesMapFilter(null as any, 'office')).toBe(true);
  });

  it('laesst Players durch, wenn beide leer sind', () => {
    expect(passesMapFilter('', '')).toBe(true);
    expect(passesMapFilter(undefined, undefined as any)).toBe(true);
  });

  it('akzeptiert Players auf gleicher Map', () => {
    expect(passesMapFilter('office', 'office')).toBe(true);
  });

  it('verwirft Players auf anderer Map', () => {
    expect(passesMapFilter('lounge', 'office')).toBe(false);
    expect(passesMapFilter('office', 'lounge')).toBe(false);
  });
});
