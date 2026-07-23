import type { BrandContext, SendGuestInviteParams, SendRawParams } from '../../types.js';
import { escapeHtml, stripCrlf } from '../../htmlUtils.js';
import { button, footer, htmlShell } from '../shared.js';

/**
 * EN renderer for guest-invite emails with magic link.
 */
export function renderGuestInviteEn(params: SendGuestInviteParams, brand: BrandContext): SendRawParams {
  const inviterRaw = params.inviterName;
  const tenantRaw = params.tenantName;
  const guestRaw = params.guestName || 'there';
  const inviter = escapeHtml(inviterRaw);
  const tenant = escapeHtml(tenantRaw);
  const guest = escapeHtml(guestRaw);
  const brandName = escapeHtml(brand.brandName);
  const expires = escapeHtml(params.expiresAt);
  const expiresRaw = params.expiresAt;

  const subject = stripCrlf(`${inviterRaw} invited you as a guest to ${tenantRaw}`);
  const heading = "You've been invited as a guest";
  const greeting = `Hi ${guest},`;
  const greetingText = `Hi ${guestRaw},`;
  const bodyHtml = `<strong>${inviter}</strong> has invited you as a guest to <strong>${tenant}</strong> on ${brandName}.`;
  const bodyText = `${inviterRaw} has invited you as a guest to "${tenantRaw}" on ${brand.brandName}.`;
  const buttonLabel = 'Join as Guest';
  const expiryHtml = `Your access is valid until <strong>${expires}</strong>.`;
  const expiryText = `Your access is valid until ${expiresRaw}.`;
  const noPassword = 'No password required – the link is all you need.';
  const ignore = "If you didn't expect this invitation, you can safely ignore this email.";
  const signoff = 'Best,';
  const team = `The ${brand.brandName} Team`;

  const html = htmlShell(`
  <h2 style="color: #1a1a1a;">${heading}</h2>
  <p>${greeting}</p>
  <p>${bodyHtml}</p>
  ${button(params.magicLinkUrl, buttonLabel)}
  <p style="color: #666; font-size: 14px;">${expiryHtml}</p>
  <p style="color: #666; font-size: 14px;">${escapeHtml(noPassword)}</p>
  ${footer(brand.brandName)}`);

  const text = `${greetingText}\n\n${bodyText}\n\n${params.magicLinkUrl}\n\n${expiryText} ${noPassword}\n\n${ignore}\n\n${signoff}\n${team}`;

  return {
    to: params.to,
    subject,
    text,
    html,
  };
}
