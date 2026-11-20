// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PublicFooter } from './PublicFooter';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { year?: number; brandName?: string }) =>
      opts?.year != null ? `${k}:${opts.year}:${opts.brandName ?? ''}` : k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

function styleTagText(container: HTMLElement): string {
  return Array.from(container.querySelectorAll('style'))
    .map((el) => el.textContent ?? '')
    .join('\n');
}

describe('PublicFooter responsive styles', () => {
  it('ships stylesheet rules without !important and keeps justify-content off the style attribute', () => {
    const { container } = render(<PublicFooter navigate={vi.fn()} />);

    const css = styleTagText(container);
    expect(css).not.toMatch(/!important/i);

    const columns = container.querySelector('.pub-footer__columns');
    expect(columns).not.toBeNull();
    expect(columns?.getAttribute('style') ?? '').not.toMatch(/(^|;)\s*justify-content\s*:/i);
  });
});
