import { afterEach, describe, expect, it } from 'vitest';
import { buildPublicWebLink, publicBaseUrlProblem, publicWebBase, resolvePublicWebBase } from './publicLinks.js';

const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;
const originalAllowLoopback = process.env.PUBLIC_BASE_URL_ALLOW_LOOPBACK;
const originalBillingPublicUrl = process.env.BILLING_PUBLIC_URL;

afterEach(() => {
  if (originalPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;
  if (originalAllowLoopback === undefined) delete process.env.PUBLIC_BASE_URL_ALLOW_LOOPBACK;
  else process.env.PUBLIC_BASE_URL_ALLOW_LOOPBACK = originalAllowLoopback;
  if (originalBillingPublicUrl === undefined) delete process.env.BILLING_PUBLIC_URL;
  else process.env.BILLING_PUBLIC_URL = originalBillingPublicUrl;
});

describe('resolvePublicWebBase', () => {
  it('trims whitespace and trailing slashes while preserving the path', () => {
    expect(
      resolvePublicWebBase({ publicBaseUrl: '  https://public.example/work/room///  ', allowLoopback: false }),
    ).toBe('https://public.example/work/room');
  });

  it.each([undefined, '', '  \t  ', 'public.example', 'ftp://public.example', 'tauri://localhost'])(
    'rejects an unusable base %s',
    (publicBaseUrl) => {
      expect(resolvePublicWebBase({ publicBaseUrl, allowLoopback: true })).toBeNull();
    },
  );

  it.each(['http://tauri.localhost', 'https://desktop.tauri.localhost'])(
    'always rejects the Tauri host %s',
    (publicBaseUrl) => {
      expect(resolvePublicWebBase({ publicBaseUrl, allowLoopback: false })).toBeNull();
      expect(resolvePublicWebBase({ publicBaseUrl, allowLoopback: true })).toBeNull();
    },
  );

  it.each([
    'http://localhost:5173',
    'https://client.localhost',
    'http://127.0.0.1:4200',
    'http://127.42.5.3',
    'http://[::1]:4200',
    'http://0.0.0.0:4200',
  ])('rejects loopback base %s without the explicit switch', (publicBaseUrl) => {
    expect(resolvePublicWebBase({ publicBaseUrl, allowLoopback: false })).toBeNull();
  });

  it.each([
    'http://localhost:5173',
    'https://client.localhost',
    'http://127.0.0.1:4200',
    'http://127.42.5.3',
    'http://[::1]:4200',
    'http://0.0.0.0:4200',
  ])('allows loopback base %s with the explicit switch', (publicBaseUrl) => {
    expect(resolvePublicWebBase({ publicBaseUrl, allowLoopback: true })).toBe(publicBaseUrl);
  });
});

describe('publicBaseUrlProblem', () => {
  it('reports a missing base', () => {
    expect(publicBaseUrlProblem({ publicBaseUrl: undefined, allowLoopback: false })).toBe('missing');
    expect(publicBaseUrlProblem({ publicBaseUrl: '  ', allowLoopback: false })).toBe('missing');
  });

  it.each([
    'public.example',
    'ftp://public.example',
    'https://public.example/path?invite=code',
    'https://public.example/path#app',
    'https://public.example/path?',
    'https://public.example/path#',
  ])('reports invalid base %s', (publicBaseUrl) => {
    expect(publicBaseUrlProblem({ publicBaseUrl, allowLoopback: true })).toBe('invalid');
  });

  it.each(['tauri://localhost', 'http://tauri.localhost', 'https://desktop.tauri.localhost'])(
    'reports native base %s',
    (publicBaseUrl) => {
      expect(publicBaseUrlProblem({ publicBaseUrl, allowLoopback: true })).toBe('native');
    },
  );

  it.each(['http://localhost:5173', 'http://127.0.0.1:4200', 'http://[::1]:4200', 'http://0.0.0.0:4200'])(
    'reports loopback base %s when it is disabled',
    (publicBaseUrl) => {
      expect(publicBaseUrlProblem({ publicBaseUrl, allowLoopback: false })).toBe('loopback');
    },
  );

  it('returns null for valid public bases and explicitly allowed loopback bases', () => {
    expect(publicBaseUrlProblem({ publicBaseUrl: 'https://public.example/work', allowLoopback: false })).toBeNull();
    expect(publicBaseUrlProblem({ publicBaseUrl: 'http://localhost:42040', allowLoopback: true })).toBeNull();
  });

  it.each(['https://public.example/path?query=1', 'https://public.example/path#section'])(
    'makes resolvePublicWebBase reject base %s',
    (publicBaseUrl) => {
      expect(resolvePublicWebBase({ publicBaseUrl, allowLoopback: true })).toBeNull();
    },
  );
});

describe('public web link helpers', () => {
  it('builds a hash route beneath the configured base path', () => {
    expect(buildPublicWebLink('https://public.example/work', 'reset?token=abc')).toBe(
      'https://public.example/work/#/reset?token=abc',
    );
  });

  it('reads PUBLIC_BASE_URL and the loopback switch from the environment', () => {
    process.env.PUBLIC_BASE_URL = 'http://localhost:42040/';
    process.env.PUBLIC_BASE_URL_ALLOW_LOOPBACK = 'true';
    process.env.BILLING_PUBLIC_URL = 'https://billing.example';

    expect(publicWebBase()).toBe('http://localhost:42040');
  });

  it('does not use BILLING_PUBLIC_URL when PUBLIC_BASE_URL is missing', () => {
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.PUBLIC_BASE_URL_ALLOW_LOOPBACK;
    process.env.BILLING_PUBLIC_URL = 'https://billing.example';

    expect(publicWebBase()).toBeNull();
  });
});
