import type { EmailLocale, SendRawParams } from '../../emailLoader.js';
import { escapeHtml, stripCrlf } from '../../email/htmlUtils.js';
import { button, footer, htmlShell } from '../../email/templates/shared.js';

/**
 * Password-reset mail for the self-service forgot-password flow.
 *
 * Rendered here rather than in `email/templates/{de,en}/` because the
 * `EmailModule` contract (emailLoader.ts) is shared with the closed-source
 * tenancy module: adding a `sendPasswordReset` method would break every EE
 * build that does not implement it yet. `sendRaw` is the contract's designed
 * escape hatch for exactly this (the billing module renders its own mails the
 * same way) and it still passes through the provider's subject sanitisation.
 *
 * All caller-controlled strings are escaped for the HTML part; the plain-text
 * part carries them verbatim by design.
 */

export interface PasswordResetMailParams {
  to: string;
  name: string;
  resetUrl: string;
  /** Minutes until the link expires; must match the token's actual TTL. */
  expiresInMinutes: number;
  locale: EmailLocale;
}

/** Brand name for the mail. Mirrors `MAIL_BRAND_NAME` used by the OSS stack. */
function brandName(): string {
  return process.env.MAIL_BRAND_NAME || 'Meetropolis';
}

export function renderPasswordResetMail(params: PasswordResetMailParams): SendRawParams {
  return params.locale === 'en' ? renderEn(params) : renderDe(params);
}

function renderDe(params: PasswordResetMailParams): SendRawParams {
  const brand = brandName();
  const nameRaw = params.name || 'dort';
  const greetingText = `Hallo ${nameRaw},`;
  const intro = 'du hast ein neues Passwort angefordert. Über den folgenden Button vergibst du es:';
  const expiry = `Der Link ist ${params.expiresInMinutes} Minuten gültig und kann nur einmal verwendet werden.`;
  const ignore =
    'Wenn du das nicht warst, ignoriere diese E-Mail einfach — dein Passwort bleibt unverändert. ' +
    'Solltest du solche Mails häufiger bekommen, melde dich bei uns.';
  const signoff = 'Viele Grüße,';
  const team = `Das ${brand} Team`;

  const html = htmlShell(`
  <h2 style="color: #1a1a1a;">Passwort zurücksetzen</h2>
  <p>Hallo ${escapeHtml(nameRaw)},</p>
  <p>${escapeHtml(intro)}</p>
  ${button(params.resetUrl, 'Neues Passwort vergeben')}
  <p style="color: #666; font-size: 14px;">${escapeHtml(expiry)}</p>
  <p style="color: #666; font-size: 14px;">${escapeHtml(ignore)}</p>
  ${footer(brand)}`);

  return {
    to: params.to,
    subject: stripCrlf(`Passwort für ${brand} zurücksetzen`),
    text: `${greetingText}\n\n${intro}\n\n${params.resetUrl}\n\n${expiry}\n\n${ignore}\n\n${signoff}\n${team}`,
    html,
  };
}

function renderEn(params: PasswordResetMailParams): SendRawParams {
  const brand = brandName();
  const nameRaw = params.name || 'there';
  const greetingText = `Hi ${nameRaw},`;
  const intro = 'you asked for a new password. Use the button below to set one:';
  const expiry = `The link is valid for ${params.expiresInMinutes} minutes and can only be used once.`;
  const ignore =
    'If this was not you, simply ignore this email — your password stays unchanged. ' +
    'If you receive these mails often, please get in touch.';
  const signoff = 'Best regards,';
  const team = `The ${brand} team`;

  const html = htmlShell(`
  <h2 style="color: #1a1a1a;">Reset your password</h2>
  <p>Hi ${escapeHtml(nameRaw)},</p>
  <p>${escapeHtml(intro)}</p>
  ${button(params.resetUrl, 'Set a new password')}
  <p style="color: #666; font-size: 14px;">${escapeHtml(expiry)}</p>
  <p style="color: #666; font-size: 14px;">${escapeHtml(ignore)}</p>
  ${footer(brand)}`);

  return {
    to: params.to,
    subject: stripCrlf(`Reset your ${brand} password`),
    text: `${greetingText}\n\n${intro}\n\n${params.resetUrl}\n\n${expiry}\n\n${ignore}\n\n${signoff}\n${team}`,
    html,
  };
}
