import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../../system/Modal';

describe('Modal', () => {
  it('renders content when open and calls onOpenChange on close', () => {
    const onOpenChange = vi.fn();
    render(
      <Modal open={true} onOpenChange={onOpenChange} title="Title">
        <div data-testid="content">Hello</div>
      </Modal>
    );
    expect(screen.getByTestId('content')).toBeInTheDocument();
    const close = screen.getByTitle('Schließen');
    fireEvent.click(close);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});


