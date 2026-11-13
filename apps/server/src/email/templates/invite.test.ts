import { describe, expect, it } from 'vitest';
import { renderInviteDe } from './de/invite.js';
import { renderInviteEn } from './en/invite.js';
import type { BrandContext } from '../types.js';
import { formatInviteExpiry } from '../../api/utils/inviteLifecycle.js';

const brand: BrandContext = { brandName: 'Meetropolis' };

const baseDe = {
  to: 'x@y.de',
  inviterName: 'Alice',
  tenantName: 'Acme',
  inviteUrl: 'https://x/i',
};

const baseEn = {
  to: 'x@y.com',
  inviterName: 'Alice',
  tenantName: 'Acme',
  inviteUrl: 'https://x/i',
};

describe('renderInviteDe expiry', () => {
  it('names the expiry date in text and html', () => {
    const r = renderInviteDe({ ...baseDe, expiresAt: '14.11.2026, 00:30 MEZ' }, brand);
    expect(r.text).toContain('Die Einladung ist bis 14.11.2026, 00:30 MEZ gültig.');
    expect(r.html).toContain('Die Einladung ist bis 14.11.2026, 00:30 MEZ gültig.');
  });

  it('escapes the expiry value in html but keeps it raw in text', () => {
    const r = renderInviteDe({ ...baseDe, expiresAt: '<b>x</b>' }, brand);
    expect(r.html).toContain('&lt;b&gt;x&lt;&#x2F;b&gt;');
    expect(r.html).not.toContain('<b>x</b>');
    expect(r.text).toContain('Die Einladung ist bis <b>x</b> gültig.');
  });

  it('omits the expiry sentence without expiresAt', () => {
    const r = renderInviteDe({ ...baseDe }, brand);
    expect(r.text).not.toContain('gültig');
    expect(r.text).not.toContain('valid until');
    expect(r.html).not.toContain('gültig');
    expect(r.html).not.toContain('valid until');
  });
});

describe('renderInviteEn expiry', () => {
  it('names the expiry date in text and html', () => {
    const r = renderInviteEn({ ...baseEn, expiresAt: '14/11/2026, 00:30 CET' }, brand);
    expect(r.text).toContain('The invitation is valid until 14/11/2026, 00:30 CET.');
    expect(r.html).toContain('The invitation is valid until 14&#x2F;11&#x2F;2026, 00:30 CET.');
  });

  it('escapes the expiry value in html but keeps it raw in text', () => {
    const r = renderInviteEn({ ...baseEn, expiresAt: '<b>x</b>' }, brand);
    expect(r.html).toContain('&lt;b&gt;x&lt;&#x2F;b&gt;');
    expect(r.html).not.toContain('<b>x</b>');
    expect(r.text).toContain('The invitation is valid until <b>x</b>.');
  });

  it('omits the expiry sentence without expiresAt', () => {
    const r = renderInviteEn({ ...baseEn }, brand);
    expect(r.text).not.toContain('gültig');
    expect(r.text).not.toContain('valid until');
    expect(r.html).not.toContain('gültig');
    expect(r.html).not.toContain('valid until');
  });
});

describe('formatInviteExpiry', () => {
  it('formats a winter date with CET/MEZ', () => {
    const winter = new Date('2026-11-13T23:30:00Z');
    expect(formatInviteExpiry(winter, 'de')).toBe('14.11.2026, 00:30 MEZ');
    expect(formatInviteExpiry(winter, undefined)).toBe('14.11.2026, 00:30 MEZ');
    expect(formatInviteExpiry(winter, 'en')).toBe('14/11/2026, 00:30 CET');
  });

  it('formats a summer date with CEST/MESZ', () => {
    const summer = new Date('2026-07-01T10:00:00Z');
    expect(formatInviteExpiry(summer, 'de')).toBe('01.07.2026, 12:00 MESZ');
    expect(formatInviteExpiry(summer, undefined)).toBe('01.07.2026, 12:00 MESZ');
    expect(formatInviteExpiry(summer, 'en')).toBe('01/07/2026, 12:00 CEST');
  });
});
