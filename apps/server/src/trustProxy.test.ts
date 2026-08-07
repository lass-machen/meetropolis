import { afterEach, describe, expect, it, vi } from 'vitest';

const warn = vi.hoisted(() => vi.fn());

vi.mock('./logger.js', () => ({
  logger: { warn },
}));

import { resolveTrustProxySetting } from './trustProxy.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalTrustProxy = process.env.TRUST_PROXY;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = originalTrustProxy;
  warn.mockClear();
});

describe('resolveTrustProxySetting', () => {
  it.each([
    ['true', true],
    ['false', false],
    ['1', 1],
  ])('parses TRUST_PROXY=%s', (raw, expected) => {
    process.env.TRUST_PROXY = raw;

    expect(resolveTrustProxySetting()).toBe(expected);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses the non-production fallback for an invalid value and logs a warning', () => {
    process.env.NODE_ENV = 'test';
    process.env.TRUST_PROXY = 'not-a-setting';

    expect(resolveTrustProxySetting()).toBe(false);
    expect(warn).toHaveBeenCalledWith({
      event: 'trust_proxy.invalid_value',
      value: 'not-a-setting',
      fallback: false,
    });
  });

  it('uses the production fallback for an invalid value', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUST_PROXY = 'not-a-setting';

    expect(resolveTrustProxySetting()).toBe(true);
    expect(warn).toHaveBeenCalledWith({
      event: 'trust_proxy.invalid_value',
      value: 'not-a-setting',
      fallback: true,
    });
  });
});
