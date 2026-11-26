// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotFoundPage } from './NotFoundPage';

// Same stub the other view tests use: keys pass through untranslated.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'de', changeLanguage: () => Promise.resolve() },
  }),
}));

/**
 * Unknown hash paths land here instead of silently showing the landing or
 * app route, so the page states plainly that the address does not exist and
 * links back to the start page.
 */
describe('NotFoundPage', () => {
  it('shows the title, body and back-home texts', () => {
    render(<NotFoundPage />);
    expect(screen.getByText('notFound.title')).toBeInTheDocument();
    expect(screen.getByText('notFound.body')).toBeInTheDocument();
    expect(screen.getByText('notFound.backHome')).toBeInTheDocument();
  });

  it('links back to the start page', () => {
    render(<NotFoundPage />);
    expect(screen.getByText('notFound.backHome').closest('a')).toHaveAttribute('href', '#/');
  });
});
