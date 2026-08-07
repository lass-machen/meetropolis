/**
 * HTML-escape and header-sanitization helpers for the OSS mail pipeline.
 *
 * All template variables that end up as plain strings in an HTML body
 * MUST pass through `escapeHtml()`. All subjects MUST pass through
 * `stripCrlf()`, otherwise we risk header injection via caller-controlled
 * fields such as `inviterName` or `tenantName`.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
};

/**
 * Escapes the five relevant HTML special characters as well as two edge
 * cases (`/` and `` ` ``), so that caller strings cannot break out of
 * attributes or tags.
 *
 * Returns an empty string when `value` is null/undefined/empty.
 */
function coerceToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  // Objects, arrays, functions, symbols: refuse silently. Caller-controlled
  // dynamic content should never reach this helper as a non-primitive
  // anyway — if it does, treating it as an empty string is safer than
  // emitting "[object Object]" into a mail body.
  return '';
}

export function escapeHtml(value: unknown): string {
  const s = coerceToString(value);
  if (s.length === 0) return '';
  return s.replace(/[&<>"'`/]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * Removes CR, LF, and other line-break code points (U+0085 NEL,
 * U+2028 LS, U+2029 PS) from a string and collapses them into a single
 * space. Required for mail header fields such as `Subject`, because
 * nodemailer may otherwise pass through multi-line headers
 * (header injection).
 *
 * Also trims leading and trailing whitespace so that `From`/`Subject`
 * do not send unnecessary padding bytes over the wire.
 */
export function stripCrlf(value: unknown): string {
  const s = coerceToString(value);
  if (s.length === 0) return '';
  return s.replace(/[\r\n\u0085\u2028\u2029]+/g, ' ').trim();
}

/**
 * Sanitizes an optional per-message `Reply-To` address for use as a mail
 * header. Like `stripCrlf`, but distinguishes "no address given" from "an
 * address that sanitizes to nothing": both yield `undefined`, so a caller
 * passing an empty or whitespace-only value falls back to the provider
 * default rather than sending an empty header.
 *
 * The address itself is validated where it enters the system (the contact
 * route parses it with Zod); this is the defence-in-depth pass that keeps a
 * caller-controlled string from breaking out of its header line.
 */
export function sanitizeReplyTo(value: unknown): string | undefined {
  const cleaned = stripCrlf(value);
  return cleaned.length > 0 ? cleaned : undefined;
}
