import type { BrandContext, SendRawParams } from '../../types.js';
import { sanitizeReplyTo, stripCrlf } from '../../htmlUtils.js';

/**
 * Pass-through renderer for `sendRaw` calls. Subject and reply address get
 * CRLF-sanitized, body is forwarded as-is. `_brand` is accepted for signature
 * parity with the other renderers; the leading underscore tells the linter the
 * param is intentionally unused.
 */
export function renderRawEn(params: SendRawParams, _brand: BrandContext): SendRawParams {
  const replyTo = sanitizeReplyTo(params.replyTo);
  return {
    to: params.to,
    subject: stripCrlf(params.subject),
    text: params.text,
    html: params.html,
    // Spread rather than `replyTo: undefined`, so an absent reply address
    // leaves the property off entirely and the provider default applies.
    ...(replyTo && { replyTo }),
  };
}
