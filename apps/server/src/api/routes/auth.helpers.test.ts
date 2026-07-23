import { describe, it, expect } from 'vitest';
import type express from 'express';
import { isNativeClientRequest, resolvePublicBaseUrl, buildSigninResponseBody } from './auth.helpers.js';

function reqWithOrigin(origin?: string): express.Request {
  return { headers: origin === undefined ? {} : { origin } } as express.Request;
}

describe('isNativeClientRequest', () => {
  it('treats a missing Origin header as a native client', () => {
    expect(isNativeClientRequest(reqWithOrigin())).toBe(true);
  });

  it('recognises the macOS/iOS custom-scheme origin', () => {
    expect(isNativeClientRequest(reqWithOrigin('tauri://localhost'))).toBe(true);
  });

  it('recognises the Windows/Linux tauri.localhost origin', () => {
    expect(isNativeClientRequest(reqWithOrigin('http://tauri.localhost'))).toBe(true);
    expect(isNativeClientRequest(reqWithOrigin('https://tauri.localhost'))).toBe(true);
  });

  it('does not treat a regular web origin as native', () => {
    expect(isNativeClientRequest(reqWithOrigin('https://meetropolis.me'))).toBe(false);
    expect(isNativeClientRequest(reqWithOrigin('https://demo.meetropolis.me'))).toBe(false);
    expect(isNativeClientRequest(reqWithOrigin('http://localhost:5173'))).toBe(false);
  });

  it('does not treat a look-alike host as native', () => {
    expect(isNativeClientRequest(reqWithOrigin('https://tauri.localhost.evil.com'))).toBe(false);
  });
});

describe('buildSigninResponseBody', () => {
  const user = { id: 'user-1', email: 'a@b.test', name: 'Ada' };

  it('echoes the JWT in the body for a native client', () => {
    const body = buildSigninResponseBody(user, 'jwt-token', isNativeClientRequest(reqWithOrigin('tauri://localhost')));
    expect(body).toEqual({ id: 'user-1', email: 'a@b.test', name: 'Ada', token: 'jwt-token' });
  });

  it('echoes the JWT for the Windows/Linux tauri.localhost origin', () => {
    const body = buildSigninResponseBody(
      user,
      'jwt-token',
      isNativeClientRequest(reqWithOrigin('http://tauri.localhost')),
    );
    expect(body.token).toBe('jwt-token');
  });

  it('echoes the JWT when the Origin header is absent (native default)', () => {
    const body = buildSigninResponseBody(user, 'jwt-token', isNativeClientRequest(reqWithOrigin()));
    expect(body.token).toBe('jwt-token');
  });

  it('omits the JWT from the body for a browser origin (cookie-only)', () => {
    const body = buildSigninResponseBody(
      user,
      'jwt-token',
      isNativeClientRequest(reqWithOrigin('https://demo.meetropolis.me')),
    );
    expect(body).toEqual({ id: 'user-1', email: 'a@b.test', name: 'Ada' });
    expect('token' in body).toBe(false);
  });

  it('preserves a null name', () => {
    const body = buildSigninResponseBody({ id: 'u', email: 'e@x.test', name: null }, 'jwt-token', true);
    expect(body.name).toBeNull();
    expect(body.token).toBe('jwt-token');
  });
});

describe('resolvePublicBaseUrl', () => {
  it('prefers PUBLIC_BASE_URL over everything else', () => {
    expect(
      resolvePublicBaseUrl({
        publicBaseUrl: 'https://public.example',
        billingPublicUrl: 'https://billing.example',
        origin: 'https://origin.example',
        host: 'host.example',
      }),
    ).toBe('https://public.example');
  });

  it('falls back to BILLING_PUBLIC_URL when PUBLIC_BASE_URL is absent', () => {
    expect(
      resolvePublicBaseUrl({ billingPublicUrl: 'https://billing.example', origin: 'https://origin.example' }),
    ).toBe('https://billing.example');
  });

  it('uses a real http(s) Origin when no explicit base URL is configured', () => {
    expect(resolvePublicBaseUrl({ origin: 'https://origin.example', host: 'host.example' })).toBe(
      'https://origin.example',
    );
  });

  it('ignores a native-client Origin and falls through to the Host header', () => {
    expect(resolvePublicBaseUrl({ origin: 'tauri://localhost', host: 'meetropolis.me' })).toBe(
      'https://meetropolis.me',
    );
  });

  it('returns an empty string when nothing usable is available', () => {
    expect(resolvePublicBaseUrl({})).toBe('');
    expect(resolvePublicBaseUrl({ origin: 'tauri://localhost' })).toBe('');
  });
});
