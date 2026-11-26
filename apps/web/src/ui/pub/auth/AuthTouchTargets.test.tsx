// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoginView } from './LoginView';

const publicCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../styles/public.css'), 'utf8');

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const TEXT_LINK_KEYS = ['auth.forgotPasswordLink', 'auth.loginRegisterLink', 'auth.loginInviteLink'] as const;

function ruleBody(selector: string): string {
  const pattern = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`);
  const match = publicCss.match(pattern);
  if (!match) throw new Error(`missing stylesheet rule for ${selector}`);
  return match[1];
}

describe('login text links', () => {
  it('exposes every text link through the shared touch-target class', () => {
    render(<LoginView onSubmit={() => Promise.resolve()} onForgot={vi.fn()} onRegister={vi.fn()} onInvite={vi.fn()} />);
    for (const key of TEXT_LINK_KEYS) {
      expect(screen.getByRole('button', { name: key })).toHaveClass('pub-auth-text-link');
    }
  });

  it('gives the shared text-link rule a 44px minimum height', () => {
    expect(ruleBody('.pub-auth-text-link')).toMatch(/min-height\s*:\s*44px/);
  });
});

describe('registration step indicator', () => {
  it('lets connectors shrink instead of forcing overflow', () => {
    const body = ruleBody('.pub-step__connector');
    expect(body).not.toMatch(/flex-shrink\s*:\s*0/);
    expect(body).toMatch(/flex\s*:\s*0\s+1\s+48px/);
  });

  it('caps the indicator at the available width', () => {
    expect(ruleBody('.pub-step-indicator')).toMatch(/max-width\s*:\s*100%/);
  });
});
