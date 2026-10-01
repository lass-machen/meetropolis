// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MAX_DISPLAY_NAME_LENGTH } from '@meetropolis/shared';
// Initialises i18next, so the texts below come from the shipped English locale.
import '../../../app/providers/i18n';
import { MemberSettings } from './MemberSettings';
import type { Member } from './types';

const member: Member = { id: 'm1', email: 'alice@example.test', name: 'Alice', role: 'member' };

function renderEditScreen(onEditMember = vi.fn(() => Promise.resolve(true))) {
  render(
    <MemberSettings
      members={[member]}
      saving={false}
      onChangeRole={vi.fn()}
      onRemoveMember={vi.fn()}
      onInvite={vi.fn()}
      onSuccess={vi.fn()}
      onResetPassword={vi.fn()}
      onEditMember={onEditMember}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  return onEditMember;
}

const nameField = () => screen.getByLabelText<HTMLInputElement>('Name');

describe('MemberSettings edit screen name field', () => {
  it('limits the name to the display name limit of the server', () => {
    renderEditScreen();

    expect(nameField().maxLength).toBe(MAX_DISPLAY_NAME_LENGTH);
  });

  it('sends the name trimmed', async () => {
    const onEditMember = renderEditScreen();

    fireEvent.change(nameField(), { target: { value: '  Jörg Müller ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onEditMember).toHaveBeenCalledTimes(1));
    expect(onEditMember).toHaveBeenCalledWith('m1', { email: 'alice@example.test', name: 'Jörg Müller' });
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
  ])('sends no name when the field is %s, as the server rejects a blank one', async (_label, value) => {
    const onEditMember = renderEditScreen();

    fireEvent.change(nameField(), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onEditMember).toHaveBeenCalledTimes(1));
    expect(onEditMember).toHaveBeenCalledWith('m1', { email: 'alice@example.test' });
  });
});
