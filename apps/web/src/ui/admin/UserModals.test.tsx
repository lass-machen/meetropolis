import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CreateUserModal } from './UserModals';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, opts?: { email?: string }) => (opts?.email ? `${key}:${opts.email}` : key),
  }),
}));

let emailSent = true;
let lastBody: unknown = null;

function stubApi() {
  lastBody = null;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && String(url).endsWith('/auth/invite')) {
        lastBody = JSON.parse(init.body as string);
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () =>
            Promise.resolve({
              code: 'ABC123',
              role: 'member',
              inviteUrl: 'https://public.example/#/?invite=ABC123',
              expiresAt: '2026-02-01T00:00:00.000Z',
              emailSent,
            }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    }),
  );
}

function renderModal() {
  const setError = vi.fn();
  render(<CreateUserModal open onOpenChange={vi.fn()} baseUrl="http://api.test" isOwner={false} setError={setError} />);
  return { setError };
}

function fillEmail(email: string) {
  fireEvent.change(screen.getByPlaceholderText('admin.users.emailAddress'), { target: { value: email } });
}

function submitButton() {
  return screen.getByText('admin.users.createInvite').closest('button') as HTMLButtonElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CreateUserModal invite delivery', () => {
  it('disables creating while the email is empty', () => {
    emailSent = true;
    stubApi();
    renderModal();

    expect(submitButton()).toBeDisabled();
    fillEmail('new@example.test');
    expect(submitButton()).not.toBeDisabled();
  });

  it('shows the sent confirmation with the address when the email was sent', async () => {
    emailSent = true;
    stubApi();
    renderModal();

    fillEmail('new@example.test');
    fireEvent.click(submitButton());

    expect(await screen.findByText('tenant.inviteSentTo:new@example.test')).toBeTruthy();
    expect(screen.getByText('https://public.example/#/?invite=ABC123')).toBeTruthy();
    expect(screen.getByText('admin.users.copy')).toBeTruthy();
    expect(lastBody).toMatchObject({ email: 'new@example.test' });
  });

  it('shows the not-delivered hint and the link when the email was not sent', async () => {
    emailSent = false;
    stubApi();
    renderModal();

    fillEmail('new@example.test');
    fireEvent.click(submitButton());

    expect(await screen.findByText('tenant.inviteResendNotDelivered')).toBeTruthy();
    expect(screen.getByText('https://public.example/#/?invite=ABC123')).toBeTruthy();
    expect(screen.getByText('admin.users.copy')).toBeTruthy();
  });
});
