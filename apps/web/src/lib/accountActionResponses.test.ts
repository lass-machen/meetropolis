import { expect, it } from 'vitest';
import {
  AccountActionError,
  needsEmailVerification,
  readAccountError,
  readEmailChangePending,
  readMailSent,
  readProofResult,
} from './accountActionResponses';

it('preserves status, stable code, message and retry delay across response formats', () => {
  expect(readAccountError({ error: 'Please confirm.', code: 'EMAIL_VERIFICATION_REQUIRED' })).toEqual({
    code: 'EMAIL_VERIFICATION_REQUIRED',
    message: 'Please confirm.',
    retryAfter: null,
  });
  expect(readAccountError({ error: { code: 'RATE_LIMITED', message: 'Bitte warten.' }, retryAfter: 15 })).toEqual({
    code: 'RATE_LIMITED',
    message: 'Bitte warten.',
    retryAfter: 15,
  });
  expect(needsEmailVerification(new AccountActionError(409, 'EMAIL_VERIFICATION_REQUIRED', 'Please confirm.'))).toBe(
    true,
  );
  expect(needsEmailVerification(new AccountActionError(403, 'forbidden', 'No access.'))).toBe(false);
});

it('does not infer delivery or a confirmed email change from unknown JSON', () => {
  for (const value of [null, undefined, '', [], true, { sent: false }, { sent: 'true' }])
    expect(readMailSent(value)).toBe(false);
  expect(readMailSent({ sent: true })).toBe(true);
  expect(readEmailChangePending({ emailChangePending: true, pendingEmail: 'new@example.test' })).toBe(
    'new@example.test',
  );
  expect(readEmailChangePending({ emailChangePending: 'true', pendingEmail: 'new@example.test' })).toBeNull();
  expect(readProofResult({ ok: true, purpose: 'unknown' })).toBeNull();
  expect(readProofResult({ ok: true, purpose: 'email_change' })).toEqual({ purpose: 'email_change', tenantSlug: null });
});
