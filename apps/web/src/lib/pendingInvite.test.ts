// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PENDING_INVITE_KEY,
  clearPendingInvite,
  inviteHash,
  readPendingInvite,
  storePendingInvite,
} from './pendingInvite';

describe('pendingInvite', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('stores and reads a code', () => {
    storePendingInvite('MEET-ABC-123456');
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBe('MEET-ABC-123456');
    expect(readPendingInvite()).toBe('MEET-ABC-123456');
  });

  it('reads null when nothing is stored', () => {
    expect(readPendingInvite()).toBeNull();
  });

  it('clears a stored code', () => {
    storePendingInvite('MEET-ABC-123456');
    clearPendingInvite();
    expect(readPendingInvite()).toBeNull();
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });

  it('encodes the code into the invite hash', () => {
    expect(inviteHash('MEET A/B?C')).toBe(`#/?invite=${encodeURIComponent('MEET A/B?C')}`);
  });
});
