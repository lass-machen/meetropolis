/**
 * Shared template building blocks for the OSS mail stack.
 *
 * All functions here assume that dynamic strings from the caller have
 * already passed through `escapeHtml()` (body) or `stripCrlf()`
 * (subject). The template files in `templates/{de,en}/` are responsible
 * for the escaping.
 */

import { escapeHtml } from '../htmlUtils.js';

/**
 * Wraps an already-rendered body in the HTML shell. The `body`
 * is embedded verbatim — it MUST already be escaped.
 */
export function htmlShell(body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
${body}
</body>
</html>`;
}

/**
 * Renders a call-to-action button. Both `url` and `label` are
 * defensively escaped because URLs are caller-controlled (e.g.
 * `verifyUrl`, `magicLinkUrl`) and end up inside attributes.
 */
export function button(url: string, label: string): string {
  return `<p style="margin: 30px 0;">
  <a href="${escapeHtml(url)}" style="background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">${escapeHtml(label)}</a>
</p>`;
}

/**
 * Renders a horizontal rule and a plain brand footer for OSS mails.
 * The `brandName` is escaped; everything else is static.
 */
export function footer(brandName: string, supportText: string = ''): string {
  const support = supportText ? `<p style="color: #666;">${supportText}</p>` : '';
  return `<hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  ${support}
  <p style="color: #999; font-size: 12px;">Sent by ${escapeHtml(brandName)}</p>`;
}
