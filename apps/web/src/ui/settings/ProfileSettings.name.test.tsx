// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MAX_DISPLAY_NAME_LENGTH } from '@meetropolis/shared';
import i18n from '../../app/providers/i18n';

vi.mock('../../lib/apiBase', () => ({ getApiBaseFromWindow: () => 'http://api.test' }));
// The avatar section pulls in the game bridge; it has nothing to do with the name.
vi.mock('./ProfileAvatarSection', () => ({ ProfileAvatarSection: () => null }));

import { ProfileSettings } from './ProfileSettings';

interface StoredUser {
  id: string;
  email: string;
  name: string | null;
}

interface PatchReply {
  status: number;
  body: unknown;
}

/** Stubs fetch: GET /auth/me returns `user`, PATCH /me answers with `reply`. */
function stubApi(user: StoredUser, reply: PatchReply) {
  const patches: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patches.push(JSON.parse(init.body as string));
        return Promise.resolve({
          ok: reply.status < 400,
          status: reply.status,
          json: () => Promise.resolve(reply.body),
        });
      }
      if (url.endsWith('/auth/me')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ user }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    }),
  );
  return patches;
}

// The real i18n instance, in English: the texts below come from the shipped locale files.
const nameField = () => screen.getByPlaceholderText<HTMLInputElement>('Your name');
const emailField = () => screen.getByLabelText<HTMLInputElement>('New email address');

async function renderLoaded(): Promise<void> {
  render(<ProfileSettings onClose={vi.fn()} />);
  await screen.findByLabelText('New email address');
}

function save(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProfileSettings name field', () => {
  it('limits the name to the display name limit of the server', async () => {
    stubApi({ id: 'u1', email: 'a@example.test', name: 'Alice' }, { status: 200, body: {} });
    await renderLoaded();

    expect(nameField().maxLength).toBe(MAX_DISPLAY_NAME_LENGTH);
  });

  it('lets an account without a name change its e-mail address: no name is sent', async () => {
    const patches = stubApi(
      { id: 'u1', email: 'old@example.test', name: null },
      {
        status: 202,
        body: {
          id: 'u1',
          email: 'old@example.test',
          name: null,
          emailChangePending: true,
          pendingEmail: 'new@example.test',
          sent: true,
        },
      },
    );
    await renderLoaded();
    expect(nameField().value).toBe('');

    fireEvent.change(emailField(), { target: { value: 'new@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request email change' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ email: 'new@example.test' });
    expect(await screen.findByText(/A confirmation link was sent/)).toBeTruthy();
    expect(screen.getByText('old@example.test')).toBeTruthy();
  });

  it('sends no name when the field only holds whitespace', async () => {
    const patches = stubApi(
      { id: 'u1', email: 'a@example.test', name: null },
      { status: 200, body: { id: 'u1', email: 'a@example.test', name: null } },
    );
    await renderLoaded();

    fireEvent.change(nameField(), { target: { value: '   ' } });
    save();

    await screen.findByText('Profile updated successfully');
    expect(patches).toHaveLength(0);
  });

  it('sends the trimmed name and shows the stored one afterwards', async () => {
    const patches = stubApi(
      { id: 'u1', email: 'a@example.test', name: null },
      { status: 200, body: { id: 'u1', email: 'a@example.test', name: 'Jorg Muller' } },
    );
    await renderLoaded();

    fireEvent.change(nameField(), { target: { value: '  Jorg Muller  ' } });
    save();

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ name: 'Jorg Muller' });
    await waitFor(() => expect(nameField().value).toBe('Jorg Muller'));
  });

  it('keeps the stored name when the field was cleared: the field shows it again after the save', async () => {
    const patches = stubApi(
      { id: 'u1', email: 'a@example.test', name: 'Alice' },
      { status: 200, body: { id: 'u1', email: 'a@example.test', name: 'Alice' } },
    );
    await renderLoaded();
    await waitFor(() => expect(nameField().value).toBe('Alice'));

    fireEvent.change(nameField(), { target: { value: '' } });
    save();

    await screen.findByText('Profile updated successfully');
    expect(patches).toHaveLength(0);
    await waitFor(() => expect(nameField().value).toBe('Alice'));
  });

  it('shows the hint for a rejected name instead of the raw code', async () => {
    stubApi({ id: 'u1', email: 'a@example.test', name: 'Alice' }, { status: 400, body: { error: 'invalid name' } });
    await renderLoaded();

    save();

    expect(
      await screen.findByText(`Invalid name: it must be 1 to ${MAX_DISPLAY_NAME_LENGTH} characters long`),
    ).toBeTruthy();
    expect(screen.queryByText('invalid name')).toBeNull();
  });
});
