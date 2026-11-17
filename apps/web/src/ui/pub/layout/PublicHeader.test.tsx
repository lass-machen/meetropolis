// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PublicHeader } from './PublicHeader';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

function renderHeader() {
  return render(<PublicHeader onLogin={vi.fn()} onSignup={vi.fn()} />);
}

function styleTagText(container: HTMLElement): string {
  return Array.from(container.querySelectorAll('style'))
    .map((el) => el.textContent ?? '')
    .join('\n');
}

describe('PublicHeader responsive styles', () => {
  it('ships stylesheet rules without !important and keeps display off the style attribute', () => {
    const { container } = renderHeader();

    const css = styleTagText(container);
    expect(css).not.toMatch(/!important/i);

    const nav = container.querySelector('.pub-header__nav-desktop');
    const actions = container.querySelector('.pub-header__actions-desktop');
    const hamburger = container.querySelector('.pub-header__hamburger');
    expect(nav).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(hamburger).not.toBeNull();
    expect(nav?.getAttribute('style') ?? '').not.toMatch(/(^|;)\s*display\s*:/i);
    expect(actions?.getAttribute('style') ?? '').not.toMatch(/(^|;)\s*display\s*:/i);
    expect(hamburger?.getAttribute('style') ?? '').not.toMatch(/(^|;)\s*display\s*:/i);
  });

  it('tightens the desktop nav spacing just above the mobile breakpoint so the bar fits', () => {
    const { container } = renderHeader();
    const css = styleTagText(container);

    expect(css).toMatch(
      /@media\s*\(min-width:\s*769px\)\s*and\s*\(max-width:\s*1024px\)\s*\{[^}]*\.pub-header__nav-desktop\s*\{[^}]*gap:\s*16px/,
    );
  });
});
