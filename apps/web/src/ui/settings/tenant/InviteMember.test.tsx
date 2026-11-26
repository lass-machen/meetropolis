import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translateApiError } from '../../../lib/apiErrors';
import { InviteMember } from './InviteMember';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, opts?: { email?: string }) => (opts?.email ? `${key}:${opts.email}` : key),
  }),
}));

let originalLocation: Location;
let originalClipboard: PropertyDescriptor | undefined;
const writeText = vi.fn<() => Promise<void>>();

beforeEach(() => {
  originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, origin: 'tauri://localhost' },
  });
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  writeText.mockReset().mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

type InviteResult = {
  email: string;
  inviteUrl: string | null;
  emailSent: boolean;
  expiresAt: string | null;
};

const SENT: InviteResult = {
  email: 'member@example.test',
  inviteUrl: 'https://public.example/#/?invite=ABC123',
  emailSent: true,
  expiresAt: '2026-02-01T00:00:00.000Z',
};

function renderForm(result: InviteResult) {
  const onInvite = vi.fn().mockResolvedValue(result);
  const onSuccess = vi.fn();
  const onError = vi.fn();
  render(<InviteMember saving={false} onInvite={onInvite} onClose={vi.fn()} onSuccess={onSuccess} onError={onError} />);
  return { onInvite, onSuccess, onError };
}

function fillEmail(email: string) {
  fireEvent.change(screen.getByPlaceholderText('tenant.emailPlaceholder'), { target: { value: email } });
}

function submitButton() {
  return screen.getByText('tenant.createInvite').closest('button') as HTMLButtonElement;
}

describe('InviteMember invite links', () => {
  it('copies the URL supplied by the server and reports success afterward', async () => {
    const { onSuccess } = renderForm(SENT);

    fillEmail('member@example.test');
    fireEvent.click(submitButton());
    await screen.findByText('tenant.copyLink');
    fireEvent.click(screen.getByText('tenant.copyLink'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('tenant.linkCopied'));
    expect(writeText).toHaveBeenCalledWith('https://public.example/#/?invite=ABC123');
    expect(writeText.mock.invocationCallOrder[0]).toBeLessThan(onSuccess.mock.invocationCallOrder[0]);
  });

  it('reports the public URL error and skips clipboard when the server has no URL', async () => {
    const { onError, onSuccess } = renderForm({ ...SENT, inviteUrl: null });

    fillEmail('member@example.test');
    fireEvent.click(submitButton());
    await screen.findByText('tenant.copyLink');
    fireEvent.click(screen.getByText('tenant.copyLink'));

    await waitFor(() => expect(onError).toHaveBeenCalledWith(translateApiError('public_base_url_missing')));
    expect(writeText).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('reports a clipboard error and does not report success when copying fails', async () => {
    writeText.mockRejectedValue(new Error('clipboard unavailable'));
    const { onError, onSuccess } = renderForm(SENT);

    fillEmail('member@example.test');
    fireEvent.click(submitButton());
    await screen.findByText('tenant.copyLink');
    fireEvent.click(screen.getByText('tenant.copyLink'));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('tenant.linkCopyFailed'));
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe('InviteMember email requirement', () => {
  it('disables the submit button while the email field is empty', () => {
    const { onInvite } = renderForm(SENT);

    expect(submitButton()).toBeDisabled();
    fillEmail('   ');
    expect(submitButton()).toBeDisabled();
    fillEmail('member@example.test');
    expect(submitButton()).not.toBeDisabled();
    expect(onInvite).not.toHaveBeenCalled();
  });
});

describe('InviteMember delivery feedback', () => {
  it('shows the sent message with the address when the email was sent', async () => {
    renderForm(SENT);

    fillEmail('member@example.test');
    fireEvent.click(submitButton());

    expect(await screen.findByText('tenant.inviteSentTo:member@example.test')).toBeTruthy();
    expect(screen.getByText('https://public.example/#/?invite=ABC123')).toBeTruthy();
    expect(screen.getByText('tenant.copyLink')).toBeTruthy();
  });

  it('shows the not-delivered hint and the link when the email was not sent', async () => {
    renderForm({ ...SENT, emailSent: false });

    fillEmail('member@example.test');
    fireEvent.click(submitButton());

    expect(await screen.findByText('tenant.inviteResendNotDelivered')).toBeTruthy();
    expect(screen.getByText('https://public.example/#/?invite=ABC123')).toBeTruthy();
    expect(screen.getByText('tenant.copyLink')).toBeTruthy();
  });
});
