// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import deCommon from './de/common.json';
import enCommon from './en/common.json';
import dePublic from './de/public.json';
import enPublic from './en/public.json';

const inviteErrorKeys = [
  'apiError.invite_email_mismatch',
  'apiError.invite_unavailable',
  'apiError.invite_expired',
  'apiError.already_member',
];

function localeMessages(lang: 'de' | 'en') {
  const common = (lang === 'de' ? deCommon : enCommon) as Record<string, unknown>;
  const pub = (lang === 'de' ? dePublic : enPublic) as { auth: Record<string, unknown> };
  return { common, required: pub.auth.requiredFieldsMissing };
}

describe('invite and required-field messages', () => {
  for (const lang of ['de', 'en'] as const) {
    it(`has non-empty invite and required-field messages in ${lang}`, () => {
      const { common, required } = localeMessages(lang);

      for (const key of inviteErrorKeys) {
        expect(typeof common[key], key).toBe('string');
        expect((common[key] as string).length).toBeGreaterThan(0);
      }
      expect(typeof required).toBe('string');
      expect((required as string).length).toBeGreaterThan(0);
    });
  }
});
