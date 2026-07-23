import { describe, it, expect } from 'vitest';
import { getDisplayName } from './displayName';

describe('getDisplayName', () => {
  it('returns mapped name from nameMap', () => {
    const name = getDisplayName('abc', { abc: 'Alice' }, { id: 'me' });
    expect(name).toBe('Alice');
  });

  it('returns self name when identity equals me.id/email', () => {
    expect(getDisplayName('me', {}, { id: 'me', name: 'Me' })).toBe('Me');
    expect(getDisplayName('me@mail', {}, { id: 'id', email: 'me@mail', name: 'X' })).toBe('X');
  });

  it('shortens long alphanumeric identities', () => {
    const id = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const res = getDisplayName(id, {}, null);
    expect(res.startsWith('User ')).toBe(true);
    expect(res.length).toBeGreaterThan(5);
  });

  it('falls back to identity', () => {
    expect(getDisplayName('bob', {}, null)).toBe('bob');
  });
});
