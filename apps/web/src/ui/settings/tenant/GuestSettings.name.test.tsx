// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MAX_DISPLAY_NAME_LENGTH } from '@meetropolis/shared';
// Initialises i18next, so the texts below come from the shipped English locale.
import '../../../app/providers/i18n';
import { GuestSettings } from './GuestSettings';

function renderInviteForm() {
  render(
    <GuestSettings
      guests={[]}
      saving={false}
      onCreateGuest={vi.fn(() => Promise.resolve(null))}
      onRevokeGuest={vi.fn(() => Promise.resolve())}
      onSuccess={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Invite guest' }));
}

describe('GuestSettings invite form name field', () => {
  it('limits the name to the display name limit of the server', () => {
    renderInviteForm();

    expect(screen.getByPlaceholderText<HTMLInputElement>('Name (optional)').maxLength).toBe(MAX_DISPLAY_NAME_LENGTH);
  });
});
