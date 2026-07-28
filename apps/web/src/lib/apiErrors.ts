import i18n from '../app/providers/i18n';

/**
 * Translates an API error into a localized message.
 *
 * The API produces the `error` field in two shapes and this function accepts
 * either, plus anything malformed, without ever calling a string method on a
 * non-string value:
 *  - legacy routes send a bare string code, e.g. `{ error: 'invalid credentials' }`;
 *  - the central error handler and the rate limiter send an object,
 *    e.g. `{ error: { code: 'RATE_LIMITED', message: 'Too many requests…' } }`.
 *
 * Resolution order: translate by code, then fall back to the server-provided
 * `message`, then to the raw code, then to an empty string when nothing
 * translatable is present.
 */
export function translateApiError(error: unknown): string {
  // Legacy shape: the error field is the code itself.
  if (typeof error === 'string') return translateCode(error, error);

  // Central shape: { code, message }. Translate by code, fall back to message.
  if (error !== null && typeof error === 'object') {
    const { code, message } = error as { code?: unknown; message?: unknown };
    const codeStr = typeof code === 'string' ? code : undefined;
    const messageStr = typeof message === 'string' ? message : undefined;
    if (codeStr) return translateCode(codeStr, messageStr ?? codeStr);
    return messageStr ?? '';
  }

  // null / undefined / number / boolean: nothing translatable.
  return '';
}

/**
 * Looks up `apiError.<sanitized-code>` and returns `fallback` when i18next
 * reports the key as missing (it echoes the requested key back).
 */
function translateCode(code: string, fallback: string): string {
  const key = `apiError.${code.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const translated = i18n.t(key);
  return translated === key ? fallback : translated;
}
