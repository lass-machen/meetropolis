/**
 * VAT for PRICE DISPLAY — the single place the tax rate lives.
 *
 * Scope: this module serves the *display* side only (pricing page, signup
 * wizard step 3, subscription dialog). It exists so the rate is stated once
 * instead of being re-derived as a hardcoded `* 1.19` at every price label.
 *
 * It is deliberately NOT part of checkout. At checkout Stripe Tax computes the
 * real tax from the billing country and the VAT ID, and that result is the only
 * truth: under EU reverse charge gross equals net, and a non-DE country carries
 * a different rate entirely. Wherever Stripe numbers exist, show Stripe numbers
 * — never a value produced here.
 *
 * Rate source: German standard rate (Regelsteuersatz) of 19 %, § 12 Abs. 1
 * UStG. Chosen as the display default because Meetropolis bills from Germany
 * (Tiamat UG, Ahrensburg) and DE is the seller's own jurisdiction. On the
 * public pricing page the viewer's country is unknown, so any gross figure is
 * an ASSUMPTION and must be labelled as one — see `auth.grossAssumptionNote`.
 */

/** Country the display rate belongs to (ISO 3166-1 alpha-2). */
export const DISPLAY_VAT_COUNTRY = 'DE';

/** German standard VAT rate as a fraction. 19 % → 0.19 (§ 12 Abs. 1 UStG). */
export const DISPLAY_VAT_RATE = 0.19;

/** The display rate as a whole percentage, for labels ("zzgl. 19 % USt."). */
export const DISPLAY_VAT_PERCENT = Math.round(DISPLAY_VAT_RATE * 100);

/** Net, tax and gross in integer minor units (cents), plus the rate applied. */
export interface VatBreakdown {
  /** Net amount in minor units — what the catalog stores. */
  net: number;
  /** Tax amount in minor units, rounded to whole cents. */
  vat: number;
  /** Gross amount in minor units (`net + vat`). */
  gross: number;
  /** The rate applied, as a whole percentage (19 for 19 %). */
  percent: number;
}

/**
 * Break a NET minor-unit amount into net / tax / gross for display.
 *
 * The tax is rounded to whole cents first and the gross is then the sum, so the
 * three figures always add up on screen — computing gross independently
 * (`net * 1.19` rounded) can land a cent away from `net + vat` and show a
 * breakdown that does not reconcile.
 *
 * `netMinor` may be fractional (a derived per-participant price divides an
 * integer price by a cap); the net is carried through untouched and only the
 * tax is rounded, which keeps a fractional input from silently becoming a
 * wrong-looking integer.
 */
export function vatBreakdown(netMinor: number, rate: number = DISPLAY_VAT_RATE): VatBreakdown {
  const vat = Math.round(netMinor * rate);
  return {
    net: netMinor,
    vat,
    gross: netMinor + vat,
    percent: Math.round(rate * 100),
  };
}
