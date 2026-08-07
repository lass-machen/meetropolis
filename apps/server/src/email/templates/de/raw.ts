import type { BrandContext, SendRawParams } from '../../types.js';
import { sanitizeReplyTo, stripCrlf } from '../../htmlUtils.js';

/**
 * Pass-through-Renderer für `sendRaw`-Calls (z. B. Billing-Notifications).
 *
 * Der Caller liefert bereits fertige HTML/Text-Pärchen — wir lassen sie
 * unverändert durch, sanitizen aber Subject und Reply-To defensiv gegen
 * Header-Injection.
 *
 * `_brand` ist ungenutzt, weil Raw-Mails ihre eigene Markenführung
 * mitbringen. Wir akzeptieren den Parameter trotzdem für
 * Signatur-Konsistenz mit den anderen Renderern; das führende
 * Underscore signalisiert dem Linter "absichtlich nicht genutzt".
 */
export function renderRawDe(params: SendRawParams, _brand: BrandContext): SendRawParams {
  const replyTo = sanitizeReplyTo(params.replyTo);
  return {
    to: params.to,
    subject: stripCrlf(params.subject),
    text: params.text,
    html: params.html,
    // Spread statt `replyTo: undefined`, damit das Feld bei fehlender
    // Reply-Adresse ganz wegfällt und der Provider-Default greift.
    ...(replyTo && { replyTo }),
  };
}
