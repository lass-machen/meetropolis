import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmailVerificationBanner } from './EmailVerificationBanner';

// The banner reaches an initialised i18n instance through its hooks. The
// assertions read translation keys, so `t` returns the key here.
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

describe('EmailVerificationBanner', () => {
  it('renders nothing while verification status is unknown', () => {
    const { container } = render(<EmailVerificationBanner emailVerified={undefined} apiBase="/api" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing once the address is verified', () => {
    const { container } = render(<EmailVerificationBanner emailVerified={true} apiBase="/api" />);
    expect(container).toBeEmptyDOMElement();
  });

  // Regression test for A15: the banner used to set its own inline
  // position/z-index to sit above the game view, which put it above the
  // top header bar too and swallowed clicks on the menu button. The banner
  // must render in plain document flow now — no `position` or `zIndex`
  // inline style on its root — relying on WorldMainView's
  // BannerAndGameLayout to keep it clear of the header bar instead.
  it('does not set an inline position or z-index on its root element (A15)', () => {
    render(<EmailVerificationBanner emailVerified={false} apiBase="/api" />);
    const root = screen.getByText('verifyBanner.message').closest('.sys-alert');
    expect(root).not.toBeNull();
    const style = (root as HTMLElement).style;
    expect(style.position).toBe('');
    expect(style.zIndex).toBe('');
  });
});
