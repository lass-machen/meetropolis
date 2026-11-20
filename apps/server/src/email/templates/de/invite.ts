import type { BrandContext, SendInviteParams, SendRawParams } from '../../types.js';
import { escapeHtml, stripCrlf } from '../../htmlUtils.js';
import { button, footer, htmlShell } from '../shared.js';

/**
 * DE-Renderer für Invite-Mails (Admin-erzeugte Invite-Codes).
 *
 * Alle Caller-Strings werden vor dem Einbau ins HTML durch `escapeHtml()`
 * geleitet. Das Subject läuft durch `stripCrlf()`, um Header-Injection
 * über `inviterName`/`tenantName` zu verhindern.
 */
export function renderInviteDe(params: SendInviteParams, brand: BrandContext): SendRawParams {
  const inviterRaw = params.inviterName;
  const tenantRaw = params.tenantName;
  const inviter = escapeHtml(inviterRaw);
  const tenant = escapeHtml(tenantRaw);
  const brandName = escapeHtml(brand.brandName);

  const subject = stripCrlf(`${inviterRaw} hat dich zu ${tenantRaw} auf ${brand.brandName} eingeladen`);
  const heading = `Du wurdest zu ${brandName} eingeladen`;
  const bodyHtml = `<strong>${inviter}</strong> hat dich eingeladen, <strong>${tenant}</strong> auf ${brandName} beizutreten.`;
  const bodyText = `${inviterRaw} hat dich eingeladen, "${tenantRaw}" auf ${brand.brandName} beizutreten.`;
  const buttonLabel = 'Einladung annehmen';
  const description = `${brand.brandName} ist eine Plattform für gemeinsame Arbeit.`;
  const descriptionHtml = `${brandName} ist eine Plattform für gemeinsame Arbeit.`;
  const ignore = 'Falls du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.';
  const signoff = 'Viele Grüße,';
  const team = `Das ${brand.brandName} Team`;

  const expirySentence = params.expiresAt ? `Die Einladung ist bis ${params.expiresAt} gültig.` : undefined;
  const expiryHtml = expirySentence
    ? `\n  <p style="color: #666; font-size: 14px;">${escapeHtml(expirySentence)}</p>`
    : '';
  const expiryText = expirySentence ? `\n\n${expirySentence}` : '';

  const html = htmlShell(`
  <h2 style="color: #1a1a1a;">${heading}</h2>
  <p>${bodyHtml}</p>${expiryHtml}
  ${button(params.inviteUrl, buttonLabel)}
  <p style="color: #666;">${descriptionHtml}</p>
  <p style="color: #666; font-size: 14px;">${escapeHtml(ignore)}</p>
  ${footer(brand.brandName)}`);

  const text = `${bodyText}${expiryText}\n\n${params.inviteUrl}\n\n${description}\n\n${ignore}\n\n${signoff}\n${team}`;

  return {
    to: params.to,
    subject,
    text,
    html,
  };
}
