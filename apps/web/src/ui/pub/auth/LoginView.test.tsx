// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LoginView } from './LoginView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

function submitForm() {
  fireEvent.submit(screen.getByRole('button', { name: 'auth.loginSubmit' }).closest('form') as HTMLFormElement);
}

function renderView() {
  const onSubmit = vi.fn(() => Promise.resolve());
  render(<LoginView onSubmit={onSubmit} onForgot={vi.fn()} onRegister={vi.fn()} onInvite={vi.fn()} />);
  return onSubmit;
}

describe('LoginView required fields', () => {
  it('marks email and password with aria-required instead of the native required attribute', () => {
    renderView();

    const email = screen.getByLabelText('auth.emailLabel');
    const password = screen.getByPlaceholderText('••••••••');

    expect(email).not.toHaveAttribute('required');
    expect(password).not.toHaveAttribute('required');
    expect(email).toHaveAttribute('aria-required', 'true');
    expect(password).toHaveAttribute('aria-required', 'true');
  });

  it('shows a localized message and does not submit when required fields are empty', () => {
    const onSubmit = renderView();

    submitForm();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('auth.requiredFieldsMissing')).toBeInTheDocument();
  });

  it('treats whitespace-only fields as empty', () => {
    const onSubmit = renderView();

    fireEvent.change(screen.getByLabelText('auth.emailLabel'), { target: { value: '   ' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: '   ' } });
    submitForm();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('auth.requiredFieldsMissing')).toBeInTheDocument();
  });

  it('clears the message on next input and submits when the fields are filled', async () => {
    const onSubmit = renderView();

    submitForm();
    expect(screen.getByText('auth.requiredFieldsMissing')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('auth.emailLabel'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'secret' } });
    expect(screen.queryByText('auth.requiredFieldsMissing')).toBeNull();

    submitForm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('a@example.test', 'secret'));
  });
});
