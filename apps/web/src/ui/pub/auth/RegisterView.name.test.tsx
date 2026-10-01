// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MAX_DISPLAY_NAME_LENGTH } from '@meetropolis/shared';
import { RegisterView } from './RegisterView';
import { usePublicConfigStore } from '../../../state/publicConfigStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

beforeEach(() => {
  usePublicConfigStore.setState({ billingEnabled: false, loaded: true });
});

const firstNameField = () => screen.getByLabelText<HTMLInputElement>('auth.registerFirstName');
const lastNameField = () => screen.getByLabelText<HTMLInputElement>('auth.registerLastName');

function submit(onSubmit: ReturnType<typeof vi.fn>) {
  fireEvent.change(screen.getByLabelText('auth.registerEmail'), { target: { value: 'a@example.test' } });
  fireEvent.change(screen.getByLabelText('auth.registerPassword'), { target: { value: 'supersecret' } });
  fireEvent.submit(screen.getByRole('button', { name: 'auth.registerSubmit' }).closest('form') as HTMLFormElement);
  return waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
}

function renderView() {
  const onSubmit = vi.fn(() => Promise.resolve());
  render(<RegisterView onSubmit={onSubmit} onLogin={vi.fn()} />);
  return onSubmit;
}

describe('RegisterView name fields', () => {
  it('limit the two fields so that the joined name cannot exceed the display name limit', () => {
    renderView();

    expect(firstNameField().maxLength).toBe(100);
    expect(lastNameField().maxLength).toBe(99);
    expect(firstNameField().maxLength + 1 + lastNameField().maxLength).toBe(MAX_DISPLAY_NAME_LENGTH);
  });

  it('submit a joined name of exactly the limit when both fields are full', async () => {
    const onSubmit = renderView();

    fireEvent.change(firstNameField(), { target: { value: 'ä'.repeat(100) } });
    fireEvent.change(lastNameField(), { target: { value: 'ö'.repeat(99) } });
    await submit(onSubmit);

    const { name } = (onSubmit.mock.calls[0] as unknown as [{ name: string }])[0];
    expect(name).toBe(`${'ä'.repeat(100)} ${'ö'.repeat(99)}`);
    expect(name.length).toBe(MAX_DISPLAY_NAME_LENGTH);
  });

  it('submit the names trimmed and joined by one space', async () => {
    const onSubmit = renderView();

    fireEvent.change(firstNameField(), { target: { value: '  Jörg ' } });
    fireEvent.change(lastNameField(), { target: { value: ' Müller  ' } });
    await submit(onSubmit);

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Jörg Müller' }));
  });

  it('submit an empty name when the first name only holds whitespace', async () => {
    const onSubmit = renderView();

    fireEvent.change(firstNameField(), { target: { value: '   ' } });
    await submit(onSubmit);

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: '' }));
  });
});
