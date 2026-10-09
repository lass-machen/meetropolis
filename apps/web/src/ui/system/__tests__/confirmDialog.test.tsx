import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog, useConfirmDialog } from '../ConfirmDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe('ConfirmDialog', () => {
  function renderDialog(overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog open message="Really?" onConfirm={onConfirm} onCancel={onCancel} {...overrides} />);
    return { onConfirm, onCancel };
  }

  it('shows the message and the default labels', () => {
    renderDialog();

    expect(screen.getByText('Really?')).toBeTruthy();
    expect(screen.getByText('confirmDialog.confirm')).toBeTruthy();
    expect(screen.getByText('confirmDialog.cancel')).toBeTruthy();
  });

  it('uses custom labels', () => {
    renderDialog({ confirmLabel: 'Remove', cancelLabel: 'Keep' });

    expect(screen.getByText('Remove')).toBeTruthy();
    expect(screen.getByText('Keep')).toBeTruthy();
  });

  it('calls only onConfirm for the confirm button', () => {
    const { onConfirm, onCancel } = renderDialog();

    fireEvent.click(screen.getByText('confirmDialog.confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it.each([
    ['the cancel button', () => fireEvent.click(screen.getByText('confirmDialog.cancel'))],
    ['the close button', () => fireEvent.click(screen.getByTitle('Close'))],
    ['Escape', () => fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })],
  ])('calls only onCancel for %s', (_name, act_) => {
    const { onConfirm, onCancel } = renderDialog();

    act_();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders nothing while closed', () => {
    renderDialog({ open: false });

    expect(screen.queryByText('Really?')).toBeNull();
  });
});

describe('useConfirmDialog', () => {
  function Asker({ onResult }: { onResult: (ok: boolean) => void }) {
    const { confirm, dialog } = useConfirmDialog();
    return (
      <>
        <button
          onClick={() => {
            void confirm('Delete it?').then(onResult);
          }}
        >
          ask
        </button>
        <button
          onClick={() => {
            void confirm('Other?').then(onResult);
          }}
        >
          ask other
        </button>
        {dialog}
      </>
    );
  }

  async function flush() {
    await act(async () => {});
  }

  it('resolves true when confirmed and closes', async () => {
    const onResult = vi.fn();
    render(<Asker onResult={onResult} />);

    fireEvent.click(screen.getByText('ask'));
    expect(screen.getByText('Delete it?')).toBeTruthy();
    fireEvent.click(screen.getByText('confirmDialog.confirm'));
    await flush();

    expect(onResult).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.queryByText('Delete it?')).toBeNull();
  });

  it('resolves false when cancelled', async () => {
    const onResult = vi.fn();
    render(<Asker onResult={onResult} />);

    fireEvent.click(screen.getByText('ask'));
    fireEvent.click(screen.getByText('confirmDialog.cancel'));
    await flush();

    expect(onResult).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('resolves a replaced request with false and shows the newer one', async () => {
    const onResult = vi.fn();
    render(<Asker onResult={onResult} />);

    fireEvent.click(screen.getByText('ask'));
    // The first dialog is modal, so replace it the way code would: a second call.
    act(() => {
      screen.getByText('ask other').click();
    });
    await flush();

    expect(onResult).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.getByText('Other?')).toBeTruthy();
  });

  it('resolves false when its owner unmounts with a dialog open', async () => {
    const onResult = vi.fn();
    const { unmount } = render(<Asker onResult={onResult} />);
    fireEvent.click(screen.getByText('ask'));

    unmount();
    await flush();

    expect(onResult).toHaveBeenCalledExactlyOnceWith(false);
  });
});
