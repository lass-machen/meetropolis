import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { persistDnd, readPersistedDnd } from './dndPersistence';

const STORAGE_KEY = 'meetropolis.av.dnd.v1';

describe('dndPersistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to false when nothing was ever persisted', () => {
    expect(readPersistedDnd()).toBe(false);
  });

  it('round-trips an enabled DND state (the reload-survival case)', () => {
    persistDnd(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');
    expect(readPersistedDnd()).toBe(true);
  });

  it('clears the state again when DND is switched off', () => {
    persistDnd(true);
    persistDnd(false);
    expect(readPersistedDnd()).toBe(false);
  });

  it('treats any non-"true" stored value as off', () => {
    window.localStorage.setItem(STORAGE_KEY, 'yes');
    expect(readPersistedDnd()).toBe(false);
  });

  it('fails soft when storage throws (private mode / quota)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    expect(readPersistedDnd()).toBe(false);
    expect(() => persistDnd(true)).not.toThrow();
  });
});
