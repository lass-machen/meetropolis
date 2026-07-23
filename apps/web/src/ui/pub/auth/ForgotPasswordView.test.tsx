// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ForgotPasswordView } from './ForgotPasswordView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => (opts ? `${k}:${JSON.stringify(opts)}` : k),
    i18n: { language: 'de' },
  }),
}));

/**
 * "Forgot password" used to be a dead end: the copy claimed a reset link had
 * been sent while the backend never mailed one, and the UI jumped straight to a
 * form demanding a token the user could not have. The mail is real now, so the
 * view confirms and waits instead of jumping.
 */
describe('ForgotPasswordView', () => {
  it('confirms with a check-your-inbox panel instead of jumping to the token form', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<ForgotPasswordView onSubmit={onSubmit} onBack={vi.fn()} onManualToken={vi.fn()} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'max@firma.de' } });
    fireEvent.click(screen.getByText('auth.forgotSubmit'));

    await waitFor(() => expect(screen.getByText('auth.forgotSentTitle')).toBeInTheDocument());
    expect(onSubmit).toHaveBeenCalledWith('max@firma.de');
    // The confirmation names the address and the link's real 30-minute TTL.
    expect(screen.getByText('auth.forgotSentBody:{"email":"max@firma.de","minutes":30}')).toBeInTheDocument();
  });

  it('stays on the form when the request failed, so nothing false is claimed', async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    render(<ForgotPasswordView onSubmit={onSubmit} onBack={vi.fn()} onManualToken={vi.fn()} message="boom" />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'max@firma.de' } });
    fireEvent.click(screen.getByText('auth.forgotSubmit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(screen.queryByText('auth.forgotSentTitle')).toBeNull();
    expect(screen.getByText('auth.forgotSubmit')).toBeInTheDocument();
  });

  it('offers the manual-token fallback for admin-issued tokens', async () => {
    const onManualToken = vi.fn();
    render(
      <ForgotPasswordView onSubmit={vi.fn().mockResolvedValue(true)} onBack={vi.fn()} onManualToken={onManualToken} />,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'max@firma.de' } });
    fireEvent.click(screen.getByText('auth.forgotSubmit'));
    await waitFor(() => expect(screen.getByText('auth.forgotManualToken')).toBeInTheDocument());

    fireEvent.click(screen.getByText('auth.forgotManualToken'));
    expect(onManualToken).toHaveBeenCalled();
  });

  it('can go back and resend', async () => {
    render(<ForgotPasswordView onSubmit={vi.fn().mockResolvedValue(true)} onBack={vi.fn()} onManualToken={vi.fn()} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'max@firma.de' } });
    fireEvent.click(screen.getByText('auth.forgotSubmit'));
    await waitFor(() => expect(screen.getByText('auth.forgotResend')).toBeInTheDocument());

    fireEvent.click(screen.getByText('auth.forgotResend'));
    // Back on the form, ready for another attempt.
    expect(screen.getByText('auth.forgotSubmit')).toBeInTheDocument();
  });
});
