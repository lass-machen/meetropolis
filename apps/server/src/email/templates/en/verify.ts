import type { BrandContext, SendRawParams, SendVerifyParams } from '../../types.js';
import { escapeHtml, stripCrlf } from '../../htmlUtils.js';
import { button, footer, htmlShell } from '../shared.js';

/**
 * EN renderer for email-verification emails.
 */
export function renderVerifyEn(params: SendVerifyParams, brand: BrandContext): SendRawParams {
  const nameRaw = params.name || 'there';
  const name = escapeHtml(nameRaw);
  const brandName = escapeHtml(brand.brandName);

  const subject = stripCrlf(`Verify your ${brand.brandName} email`);
  const heading = 'Verify your email';
  const greeting = `Hi ${name},`;
  const greetingText = `Hi ${nameRaw},`;
  const body = 'Please verify your email address by clicking the button below:';
  const buttonLabel = 'Verify Email';
  const expiry = 'This link will expire in 24 hours.';
  const ignore = `If you didn't create a ${brand.brandName} account, you can safely ignore this email.`;
  const ignoreHtml = `If you didn't create a ${brandName} account, you can safely ignore this email.`;
  const signoff = 'Best,';
  const team = `The ${brand.brandName} Team`;

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
