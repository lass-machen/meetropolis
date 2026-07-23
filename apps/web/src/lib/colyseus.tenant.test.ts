/**
 * Regression (M2/3a): the world-room partition key (options.tenant) must be the
 * AUTHENTICATED tenant slug, not the hostname. On an apex/root domain
 * (meetropolis.me, or dev meetropolis.localhost) there is no subdomain, so
 * without this every tenant would derive 'default' and share one WorldRoom.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { deriveTenant, setAuthTenantSlug } from './colyseus';

afterEach(() => setAuthTenantSlug(null));

describe('deriveTenant', () => {
  it('returns the authenticated tenant slug once set (root-domain: no subdomain to read)', () => {
    setAuthTenantSlug('lobster-hq');
    // jsdom host is a single label ('localhost') → no subdomain; the auth slug
    // must still win so the client joins its own tenant room, not 'default'.
    expect(deriveTenant()).toBe('lobster-hq');
  });

  it("falls back to 'default' when there is no authenticated tenant and no subdomain", () => {
    setAuthTenantSlug(null);
    expect(deriveTenant()).toBe('default');
  });

  it('clears back to the fallback when the session is cleared (logout)', () => {
    setAuthTenantSlug('acme');
    expect(deriveTenant()).toBe('acme');
    setAuthTenantSlug(null);
    expect(deriveTenant()).toBe('default');
  });
});
