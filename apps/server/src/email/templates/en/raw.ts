import type { BrandContext, SendRawParams } from '../../types.js';
import { stripCrlf } from '../../htmlUtils.js';

/**
 * Pass-through renderer for `sendRaw` calls. Subject gets CRLF-sanitized,
 * body is forwarded as-is. `_brand` is accepted for signature parity with
 * the other renderers; the leading underscore tells the linter the param
 * is intentionally unused.
 */
export function renderRawEn(params: SendRawParams, _brand: BrandContext): SendRawParams {
  return {
    to: params.to,
    subject: stripCrlf(params.subject),
    text: params.text,
    html: params.html,
  };
}
