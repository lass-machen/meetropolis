import { describe, it, expect } from 'vitest';
import { DISPLAY_VAT_COUNTRY, DISPLAY_VAT_PERCENT, DISPLAY_VAT_RATE, vatBreakdown } from './vat';

describe('vat display constants', () => {
  it('states the German standard rate as the display default', () => {
    expect(DISPLAY_VAT_RATE).toBe(0.19);
    expect(DISPLAY_VAT_PERCENT).toBe(19);
    expect(DISPLAY_VAT_COUNTRY).toBe('DE');
  });
});

describe('vatBreakdown', () => {
  it('derives the documented headline case: 19,99 net -> 23,79 gross', () => {
    // The example from the display spec. 1999 * 0.19 = 379.81 -> 380 cents tax.
    expect(vatBreakdown(1999)).toEqual({ net: 1999, vat: 380, gross: 2379, percent: 19 });
  });

  it('adds up: gross is always exactly net + vat', () => {
    for (let net = 0; net <= 5000; net += 7) {
      const b = vatBreakdown(net);
      expect(b.gross).toBe(b.net + b.vat);
    }
  });

  it('rounds the tax to whole cents, half away from zero', () => {
    // 1000 * 0.19 = 190 exactly -> no rounding.
    expect(vatBreakdown(1000).vat).toBe(190);
    // 1005 * 0.19 = 190.95 -> 191.
    expect(vatBreakdown(1005).vat).toBe(191);
    // 50 * 0.19 = 9.5 -> Math.round pushes .5 up -> 10.
    expect(vatBreakdown(50).vat).toBe(10);
    // 10 * 0.19 = 1.9 -> 2.
    expect(vatBreakdown(10).vat).toBe(2);
  });

  it('never emits a fractional tax or gross for an integer net', () => {
    for (const net of [1, 99, 999, 1999, 4900, 9999, 123456]) {
      const b = vatBreakdown(net);
      expect(Number.isInteger(b.vat)).toBe(true);
      expect(Number.isInteger(b.gross)).toBe(true);
    }
  });

  it('handles a zero net without inventing tax', () => {
    expect(vatBreakdown(0)).toEqual({ net: 0, vat: 0, gross: 0, percent: 19 });
  });

  it('carries a fractional net through untouched and only rounds the tax', () => {
    // Per-participant display price: 1999 / 5 = 399.8 cents net.
    const b = vatBreakdown(1999 / 5);
    expect(b.net).toBeCloseTo(399.8, 10);
    expect(b.vat).toBe(76); // 399.8 * 0.19 = 75.962 -> 76
    expect(b.gross).toBeCloseTo(475.8, 10);
  });

  it('honours an explicit rate override and reports it back', () => {
    // A caller that knows the real rate (e.g. a non-DE country) passes it in.
    expect(vatBreakdown(1999, 0.2)).toEqual({ net: 1999, vat: 400, gross: 2399, percent: 20 });
  });

  it('treats a zero rate as reverse charge: gross equals net', () => {
    // EU reverse charge is exactly this case — no tax is added.
    expect(vatBreakdown(1999, 0)).toEqual({ net: 1999, vat: 0, gross: 1999, percent: 0 });
  });
});
