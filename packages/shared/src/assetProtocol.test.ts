import { describe, it, expect } from 'vitest';
import { parseAssetProtocolVersion } from './assetProtocol.js';

describe('parseAssetProtocolVersion', () => {
  it('accepts positive integers as number or decimal string', () => {
    expect(parseAssetProtocolVersion(1)).toBe(1);
    expect(parseAssetProtocolVersion('1')).toBe(1);
    expect(parseAssetProtocolVersion(' 2 ')).toBe(2);
  });

  it('rejects missing, empty, zero, negative, fractional and non-numeric values', () => {
    for (const value of [undefined, null, '', '0', 0, -1, '-1', 1.5, '1.5', 'abc', '1e3', '01', Number.NaN, {}, []]) {
      expect(parseAssetProtocolVersion(value)).toBeNull();
    }
  });
});
