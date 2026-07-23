import type { BrandContext, SendInviteParams, SendRawParams } from '../../types.js';
import { escapeHtml, stripCrlf } from '../../htmlUtils.js';
import { button, footer, htmlShell } from '../shared.js';

/**
 * EN renderer for admin-issued invite emails.
 */
export function renderInviteEn(params: SendInviteParams, brand: BrandContext): SendRawParams {
  const inviterRaw = params.inviterName;
  const tenantRaw = params.tenantName;
  const inviter = escapeHtml(inviterRaw);
  const tenant = escapeHtml(tenantRaw);
  const brandName = escapeHtml(brand.brandName);

  const subject = stripCrlf(`${inviterRaw} invited you to join ${tenantRaw} on ${brand.brandName}`);
  const heading = `You're invited to ${brandName}`;
  const bodyHtml = `<strong>${inviter}</strong> has invited you to join <strong>${tenant}</strong> on ${brandName}.`;
  const bodyText = `${inviterRaw} has invited you to join "${tenantRaw}" on ${brand.brandName}.`;
  const buttonLabel = 'Accept Invitation';
  const description = `${brand.brandName} is a platform for collaborative work.`;
  const descriptionHtml = `${brandName} is a platform for collaborative work.`;
  const signoff = 'Best,';
  const team = `The ${brand.brandName} Team`;

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
