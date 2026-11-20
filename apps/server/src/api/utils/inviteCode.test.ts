import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashEmailProof } from './emailProof.js';
import { hashInviteCode, newInviteCode } from './inviteCode.js';

describe('inviteCode', () => {
  it('hashes deterministically with the same SHA-256 hex procedure as hashEmailProof', () => {
    const raw = '0123456789abcdef01234567';
    const expected = crypto.createHash('sha256').update(raw).digest('hex');
    expect(hashInviteCode(raw)).toBe(expected);
    expect(hashInviteCode(raw)).toBe(hashEmailProof(raw));
    expect(hashInviteCode(raw)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('creates a raw code of 24 hex characters and its hash', () => {
    const { code, codeHash } = newInviteCode();
    expect(code).toMatch(/^[0-9a-f]{24}$/);
    expect(codeHash).toBe(hashInviteCode(code));
    expect(codeHash).not.toBe(code);
  });

  it('creates different codes on consecutive calls', () => {
    expect(newInviteCode().code).not.toBe(newInviteCode().code);
  });
});
