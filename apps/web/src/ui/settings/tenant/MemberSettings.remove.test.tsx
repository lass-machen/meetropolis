// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
// Initialises i18next, so the texts below come from the shipped English locale.
import '../../../app/providers/i18n';
import { MemberSettings } from './MemberSettings';
import type { Member } from './types';

const member: Member = { id: 'm1', email: 'alice@example.test', name: 'Alice', role: 'member' };

function renderMembers(onRemoveMember = vi.fn()) {
  render(
    <MemberSettings
      members={[member]}
      saving={false}
      onChangeRole={vi.fn()}
      onRemoveMember={onRemoveMember}
      onInvite={vi.fn()}
      onSuccess={vi.fn()}
      onResetPassword={vi.fn()}
      onEditMember={vi.fn()}
    />,
  );
  return onRemoveMember;
}

beforeEach(() => {
  // The desktop shell has no usable window.confirm; the row must not call it.
  vi.stubGlobal('confirm', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MemberSettings remove confirmation', () => {
  it('removes a member only after the in-app confirmation', async () => {
    const onRemoveMember = renderMembers();

    fireEvent.click(screen.getByTitle('Remove member'));
    expect(screen.getByText('Are you sure you want to remove this member?')).toBeTruthy();
    expect(onRemoveMember).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(onRemoveMember).toHaveBeenCalledExactlyOnceWith('m1'));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps the member when the confirmation is cancelled', async () => {
    const onRemoveMember = renderMembers();

    fireEvent.click(screen.getByTitle('Remove member'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText('Are you sure you want to remove this member?')).toBeNull());
    expect(onRemoveMember).not.toHaveBeenCalled();
  });
});
