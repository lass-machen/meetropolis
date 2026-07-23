import type { BrandContext, SendGuestInviteParams, SendRawParams } from '../../types.js';
import { escapeHtml, stripCrlf } from '../../htmlUtils.js';
import { button, footer, htmlShell } from '../shared.js';

/**
 * DE-Renderer für Guest-Invite-Mails mit Magic-Link.
 */
export function renderGuestInviteDe(params: SendGuestInviteParams, brand: BrandContext): SendRawParams {
  const inviterRaw = params.inviterName;
  const tenantRaw = params.tenantName;
  const guestRaw = params.guestName || 'dort';
  const inviter = escapeHtml(inviterRaw);
  const tenant = escapeHtml(tenantRaw);
  const guest = escapeHtml(guestRaw);
  const brandName = escapeHtml(brand.brandName);
  const expires = escapeHtml(params.expiresAt);
  const expiresRaw = params.expiresAt;

  const subject = stripCrlf(`${inviterRaw} hat dich als Gast zu ${tenantRaw} eingeladen`);
  const heading = 'Du wurdest als Gast eingeladen';
  const greeting = `Hallo ${guest},`;
  const greetingText = `Hallo ${guestRaw},`;
  const bodyHtml = `<strong>${inviter}</strong> hat dich als Gast zu <strong>${tenant}</strong> auf ${brandName} eingeladen.`;
  const bodyText = `${inviterRaw} hat dich als Gast zu "${tenantRaw}" auf ${brand.brandName} eingeladen.`;
  const buttonLabel = 'Als Gast beitreten';
  const expiryHtml = `Dein Zugang ist gültig bis <strong>${expires}</strong>.`;
  const expiryText = `Dein Zugang ist gültig bis ${expiresRaw}.`;
  const noPassword = 'Du benötigst kein Passwort – der Link genügt.';
  const ignore = 'Falls du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.';
  const signoff = 'Viele Grüße,';
  const team = `Das ${brand.brandName} Team`;

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
