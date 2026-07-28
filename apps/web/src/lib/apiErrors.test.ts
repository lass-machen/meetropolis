import { describe, it, expect, vi } from 'vitest';

// Deterministic i18next stand-in: return a registered translation, otherwise
// echo the key back — that is exactly how i18next signals a missing key, which
// `translateApiError` relies on to decide whether to fall back.
const { translations } = vi.hoisted(() => {
  const translations: Record<string, string> = {};
  return { translations };
});
vi.mock('../app/providers/i18n', () => ({
  default: { t: (key: string) => translations[key] ?? key },
}));

import { translateApiError } from './apiErrors';

describe('translateApiError', () => {
  describe('central error-handler shape { code, message } (429 regression)', () => {
    // Exactly the body the central error handler / rate limiter emits for a 429
    // (see apps/server: response.ts, errorHandler.ts, middleware/rateLimit.ts).
    const rateLimitBody = {
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' },
    };

    it('does not throw when the error field is an object (was: "e.replace is not a function")', () => {
      expect(() => translateApiError(rateLimitBody.error)).not.toThrow();
    });

    it('falls back to the server message when no translation exists for the code', () => {
      expect(translateApiError(rateLimitBody.error)).toBe('Too many requests. Please wait a moment and try again.');
    });

    it('returns the localized message when a translation exists for the code', () => {
      translations['apiError.RATE_LIMITED'] = 'Zu viele Versuche. Bitte warte einen Moment.';
      try {
        expect(translateApiError(rateLimitBody.error)).toBe('Zu viele Versuche. Bitte warte einen Moment.');
      } finally {
        delete translations['apiError.RATE_LIMITED'];
      }
    });

    it('uses the message when the code is absent', () => {
      expect(translateApiError({ message: 'Something went wrong' })).toBe('Something went wrong');
    });
  });

  describe('legacy string shape { error: "code" }', () => {
    it('falls back to the raw code when no translation exists', () => {
      expect(translateApiError('invalid credentials')).toBe('invalid credentials');
    });

    it('returns the localized message when the sanitized key resolves', () => {
      translations['apiError.invalid_credentials'] = 'Ungültige Anmeldedaten';
      try {
        expect(translateApiError('invalid credentials')).toBe('Ungültige Anmeldedaten');
      } finally {
        delete translations['apiError.invalid_credentials'];
      }
    });
  });

  describe('malformed / missing bodies never call a string method on a non-string', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['empty string', ''],
      ['number', 429],
      ['boolean', true],
      ['empty object', {}],
      ['object with non-string code', { code: 123 }],
      ['object with non-string message', { message: 42 }],
    ])('returns "" for %s without throwing', (_label, input) => {
      let result: string | undefined;
      expect(() => {
        result = translateApiError(input);
      }).not.toThrow();
      expect(result).toBe('');
    });
  });
});
