// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { FeatureShowcaseSection } from './FeatureShowcaseSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

vi.mock('../hooks/useReveal', () => ({
  useReveal: () => undefined,
}));

function styleTagText(container: HTMLElement): string {
  return Array.from(container.querySelectorAll('style'))
    .map((el) => el.textContent ?? '')
    .join('\n');
}

describe('FeatureShowcaseSection responsive styles', () => {
  it('ships stylesheet rules without !important and keeps max-width off the media image wrapper style', () => {
    const { container } = render(<FeatureShowcaseSection />);

    const css = styleTagText(container);
    expect(css).not.toMatch(/!important/i);

    const imageWrap = container.querySelector('.pub-feature-row__image > div');
    expect(imageWrap).not.toBeNull();
    expect(imageWrap?.getAttribute('style') ?? '').not.toMatch(/(^|;)\s*max-width\s*:/i);
  });
});
