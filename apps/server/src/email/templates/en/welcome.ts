import type { BrandContext, SendRawParams, SendWelcomeParams } from '../../types.js';
import { escapeHtml, stripCrlf } from '../../htmlUtils.js';
import { button, footer, htmlShell } from '../shared.js';

/**
 * EN renderer for welcome emails sent after successful tenant signup.
 */
export function renderWelcomeEn(params: SendWelcomeParams, brand: BrandContext): SendRawParams {
  const nameRaw = params.name || 'there';
  const tenantRaw = params.tenantName;
  const name = escapeHtml(nameRaw);
  const tenant = escapeHtml(tenantRaw);
  const brandName = escapeHtml(brand.brandName);
  const support = brand.supportEmail ? escapeHtml(brand.supportEmail) : '';
  const supportRaw = brand.supportEmail || '';

  const subject = stripCrlf(`Welcome to ${brand.brandName} – ${tenantRaw} is ready!`);
  const heading = `Welcome to ${brandName}!`;
  const greeting = `Hi ${name},`;
  const greetingText = `Hi ${nameRaw},`;
  const bodyHtml = `Your virtual office <strong>${tenant}</strong> is now ready.`;
  const bodyText = `Your virtual office "${tenantRaw}" is now ready.`;
  const buttonLabel = 'Enter Your Space';
  const supportHtml = support
    ? `If you have any questions, feel free to reach out to <a href="mailto:${support}">${support}</a>.`
    : '';
  const supportText = supportRaw ? `If you have any questions, feel free to reach out to ${supportRaw}.` : '';
  const signoff = 'Best,';
  const team = `The ${brand.brandName} Team`;

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
