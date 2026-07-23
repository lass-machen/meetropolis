import type { BrandContext, SendRawParams, SendVerifyParams } from '../../types.js';
import { escapeHtml, stripCrlf } from '../../htmlUtils.js';
import { button, footer, htmlShell } from '../shared.js';

/**
 * DE-Renderer für E-Mail-Verify-Mails.
 */
export function renderVerifyDe(params: SendVerifyParams, brand: BrandContext): SendRawParams {
  const nameRaw = params.name || 'dort';
  const name = escapeHtml(nameRaw);
  const brandName = escapeHtml(brand.brandName);

  const subject = stripCrlf(`E-Mail-Adresse bei ${brand.brandName} bestätigen`);
  const heading = 'E-Mail bestätigen';
  const greeting = `Hallo ${name},`;
  const greetingText = `Hallo ${nameRaw},`;
  const body = 'bitte bestätige deine E-Mail-Adresse, indem du auf den folgenden Button klickst:';
  const buttonLabel = 'E-Mail bestätigen';
  const expiry = 'Dieser Link ist 24 Stunden gültig.';
  const ignore = `Falls du kein ${brand.brandName}-Konto erstellt hast, kannst du diese E-Mail ignorieren.`;
  const ignoreHtml = `Falls du kein ${brandName}-Konto erstellt hast, kannst du diese E-Mail ignorieren.`;
  const signoff = 'Viele Grüße,';
  const team = `Das ${brand.brandName} Team`;

  const html = htmlShell(`
  <h2 style="color: #1a1a1a;">${heading}</h2>
  <p>${greeting}</p>
  <p>${escapeHtml(body)}</p>
  ${button(params.verifyUrl, buttonLabel)}
  <p style="color: #666; font-size: 14px;">${escapeHtml(expiry)}</p>
  <p style="color: #666; font-size: 14px;">${ignoreHtml}</p>
  ${footer(brand.brandName)}`);

  const text = `${greetingText}\n\n${body}\n\n${params.verifyUrl}\n\n${expiry}\n\n${ignore}\n\n${signoff}\n${team}`;

  return {
    to: params.to,
    subject,
    text,
    html,
  };
}
