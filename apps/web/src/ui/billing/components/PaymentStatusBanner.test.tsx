import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaymentStatusBanner } from './PaymentStatusBanner';
import type { PaymentStatus } from '../types';

const failingStatus: PaymentStatus = {
  status: 'failing',
  failedAt: '2026-07-01T00:00:00.000Z',
  gracePeriodEndsAt: '2026-07-10T00:00:00.000Z',
  dunningStep: 1,
  daysUntilCancellation: 9,
};

describe('PaymentStatusBanner', () => {
  it('renders nothing when payment status is ok', () => {
    const okStatus: PaymentStatus = {
      status: 'ok',
      failedAt: null,
      gracePeriodEndsAt: null,
      dunningStep: 0,
      daysUntilCancellation: null,
    };
    const { container } = render(<PaymentStatusBanner paymentStatus={okStatus} onManageBilling={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  // Regression test for A15 (second consumer with the identical pattern):
  // this banner must render in plain document flow, without an inline
  // position/z-index that would put it above the top header bar and
  // swallow clicks on the menu button.
  it('does not set an inline position or z-index on its root element (A15)', () => {
    render(<PaymentStatusBanner paymentStatus={failingStatus} onManageBilling={vi.fn()} />);
    const root = screen.getByRole('button').closest('.sys-alert');
    expect(root).not.toBeNull();
    const style = (root as HTMLElement).style;
    expect(style.position).toBe('');
    expect(style.zIndex).toBe('');
  });
});
