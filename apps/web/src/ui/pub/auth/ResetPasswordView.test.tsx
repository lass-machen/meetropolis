// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResetPasswordView } from './ResetPasswordView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => (opts ? `${k}:${JSON.stringify(opts)}` : k),
    i18n: { language: 'de' },
  }),
}));

/**
 * The mailed link carries `?token=…&email=…`, so the identified flow has both
 * already. It used to show them as read-only boxes and ask the user to review a
 * random 64-character string. The manual path stays for admin-issued tokens.
 */
describe('ResetPasswordView — arriving from the mailed link', () => {
  it('hides the token and email fields and names the account instead', () => {
    render(
      <ResetPasswordView onSubmit={vi.fn()} onBack={vi.fn()} initialToken="tok-abc" initialEmail="max@firma.de" />,
    );

    expect(screen.getByText('auth.resetForEmail:{"email":"max@firma.de"}')).toBeInTheDocument();
    expect(screen.queryByText('auth.resetTokenLabel')).toBeNull();
    // Only the password box remains visible.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('submits the token from the URL without the user retyping it', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <ResetPasswordView onSubmit={onSubmit} onBack={vi.fn()} initialToken="tok-abc" initialEmail="max@firma.de" />,
    );

    const password = container.querySelector('input[type="password"]');
    fireEvent.change(password!, { target: { value: 'new-secret-123' } });
    fireEvent.click(screen.getByText('auth.resetSubmit'));

    expect(onSubmit).toHaveBeenCalledWith('max@firma.de', 'tok-abc', 'new-secret-123');
  });
});

describe('ResetPasswordView — manual fallback', () => {
  it('shows the token and email fields when no link token is present', () => {
    render(<ResetPasswordView onSubmit={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText('auth.resetTokenLabel')).toBeInTheDocument();
    expect(screen.getByText('auth.emailLabel')).toBeInTheDocument();
    expect(screen.queryByText(/auth\.resetForEmail/)).toBeNull();
  });

  it('submits what the user typed by hand', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<ResetPasswordView onSubmit={onSubmit} onBack={vi.fn()} />);

    const textboxes = screen.getAllByRole('textbox');
    fireEvent.change(textboxes[0], { target: { value: 'admin@firma.de' } });
    fireEvent.change(textboxes[1], { target: { value: 'handed-out-token' } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: 'new-secret-123' } });
    fireEvent.click(screen.getByText('auth.resetSubmit'));

    expect(onSubmit).toHaveBeenCalledWith('admin@firma.de', 'handed-out-token', 'new-secret-123');
  });
});
