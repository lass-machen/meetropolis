/**
 * Locale dispatcher for OSS mail templates.
 *
 * Approach: a central `renderForLocale()` function that selects the
 * appropriate renderer based on `kind` and `locale`. `kind` is a
 * discriminated union over the params object so the compiler enforces
 * type narrowness per caller.
 */

import type {
  BrandContext,
  EmailLocale,
  SendGuestInviteParams,
  SendInviteParams,
  SendRawParams,
  SendVerifyParams,
  SendWelcomeParams,
} from '../types.js';

import { renderInviteDe } from './de/invite.js';
import { renderGuestInviteDe } from './de/guestInvite.js';
import { renderWelcomeDe } from './de/welcome.js';
import { renderVerifyDe } from './de/verify.js';
import { renderRawDe } from './de/raw.js';

import { renderInviteEn } from './en/invite.js';
import { renderGuestInviteEn } from './en/guestInvite.js';
import { renderWelcomeEn } from './en/welcome.js';
import { renderVerifyEn } from './en/verify.js';
import { renderRawEn } from './en/raw.js';

export type EmailKind =
  | { kind: 'invite'; params: SendInviteParams }
  | { kind: 'guestInvite'; params: SendGuestInviteParams }
  | { kind: 'welcome'; params: SendWelcomeParams }
  | { kind: 'verify'; params: SendVerifyParams }
  | { kind: 'raw'; params: SendRawParams };

function pickLocale(locale: EmailLocale | undefined): EmailLocale {
  return locale === 'en' ? 'en' : 'de';
}

/**
 * Renders the given mail template in the requested language with the
 * brand snapshot. Returns a `SendRawParams` object that can be passed
 * directly to `EmailProvider.send()`.
 */
export function renderForLocale(
  locale: EmailLocale | undefined,
  variant: EmailKind,
  brand: BrandContext,
): SendRawParams {
  const lang = pickLocale(locale);
  if (lang === 'en') {
    switch (variant.kind) {
      case 'invite':
        return renderInviteEn(variant.params, brand);
      case 'guestInvite':
        return renderGuestInviteEn(variant.params, brand);
      case 'welcome':
        return renderWelcomeEn(variant.params, brand);
      case 'verify':
        return renderVerifyEn(variant.params, brand);
      case 'raw':
        return renderRawEn(variant.params, brand);
    }
  }
  switch (variant.kind) {
    case 'invite':
      return renderInviteDe(variant.params, brand);
    case 'guestInvite':
      return renderGuestInviteDe(variant.params, brand);
    case 'welcome':
      return renderWelcomeDe(variant.params, brand);
    case 'verify':
      return renderVerifyDe(variant.params, brand);
    case 'raw':
      return renderRawDe(variant.params, brand);
  }
}
