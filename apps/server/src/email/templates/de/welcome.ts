import type { BrandContext, SendRawParams, SendWelcomeParams } from '../../types.js';
import { escapeHtml, stripCrlf } from '../../htmlUtils.js';
import { button, footer, htmlShell } from '../shared.js';

/**
 * DE-Renderer für Welcome-Mails nach erfolgreichem Tenant-Signup.
 */
export function renderWelcomeDe(params: SendWelcomeParams, brand: BrandContext): SendRawParams {
  const nameRaw = params.name || 'dort';
  const tenantRaw = params.tenantName;
  const name = escapeHtml(nameRaw);
  const tenant = escapeHtml(tenantRaw);
  const brandName = escapeHtml(brand.brandName);
  const support = brand.supportEmail ? escapeHtml(brand.supportEmail) : '';
  const supportRaw = brand.supportEmail || '';

  const subject = stripCrlf(`Willkommen bei ${brand.brandName} – ${tenantRaw} ist bereit!`);
  const heading = `Willkommen bei ${brandName}!`;
  const greeting = `Hallo ${name},`;
  const greetingText = `Hallo ${nameRaw},`;
  const bodyHtml = `Dein virtuelles Büro <strong>${tenant}</strong> ist jetzt bereit.`;
  const bodyText = `Dein virtuelles Büro "${tenantRaw}" ist jetzt bereit.`;
  const buttonLabel = 'Zum Büro';
  const supportHtml = support
    ? `Bei Fragen erreichst du uns jederzeit unter <a href="mailto:${support}">${support}</a>.`
    : '';
  const supportText = supportRaw ? `Bei Fragen erreichst du uns jederzeit unter ${supportRaw}.` : '';
  const signoff = 'Viele Grüße,';
  const team = `Das ${brand.brandName} Team`;

  const html = htmlShell(`
  <h2 style="color: #1a1a1a;">${heading}</h2>
  <p>${greeting}</p>
  <p>${bodyHtml}</p>
  ${button(params.loginUrl, buttonLabel)}
  ${supportHtml ? `<p style="color: #666;">${supportHtml}</p>` : ''}
  ${footer(brand.brandName)}`);

  const text = `${greetingText}\n\n${bodyText}\n\n${params.loginUrl}\n\n${supportText}\n\n${signoff}\n${team}`;

  return {
    to: params.to,
    subject,
    text,
    html,
  };
}
