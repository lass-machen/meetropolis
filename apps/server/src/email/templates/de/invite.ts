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
  const signoff = 'Viele Grüße,';
  const team = `Das ${brand.brandName} Team`;

  const html = htmlShell(`
  <h2 style="color: #1a1a1a;">${heading}</h2>
  <p>${bodyHtml}</p>
  ${button(params.inviteUrl, buttonLabel)}
  <p style="color: #666;">${descriptionHtml}</p>
  ${footer(brand.brandName)}`);

  const text = `${bodyText}\n\n${params.inviteUrl}\n\n${description}\n\n${signoff}\n${team}`;

  return {
    to: params.to,
    subject,
    text,
    html,
  };
}
