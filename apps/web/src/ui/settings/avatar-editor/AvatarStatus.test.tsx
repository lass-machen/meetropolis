import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AvatarStatus } from './AvatarStatus';

/**
 * The status region must already be in the DOM without a message (the container
 * must exist before the message), so that a later message can be announced at all
 * be announced.
 */
describe('AvatarStatus', () => {
  it('keeps the status region present and empty without a message', () => {
    render(<AvatarStatus status={null} />);

    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveAttribute('aria-atomic', 'true');

    // The empty region is not hidden: display:none, hidden,
    // visibility:hidden and aria-hidden would remove it from the
    // remove them from the accessibility tree. Instead, it is absolutely positioned so that it
    // keinen Platz im Flexfluss belegt.
    expect(region).not.toHaveAttribute('hidden');
    expect(region).not.toHaveAttribute('aria-hidden');
    expect(region).not.toHaveStyle({ display: 'none' });
    expect(region).not.toHaveStyle({ visibility: 'hidden' });
    expect(region).toHaveStyle({ position: 'absolute' });
  });

  it('accepts message and text change in the same node and clears it again', () => {
    const { rerender } = render(<AvatarStatus status={null} />);
    const region = screen.getByRole('status');

    rerender(<AvatarStatus status="Avatar gespeichert." />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('Avatar gespeichert.');

    // With text, the region is back in the flex flow.
    expect(region).not.toHaveStyle({ position: 'absolute' });

    rerender(<AvatarStatus status="Speichern fehlgeschlagen." />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('Speichern fehlgeschlagen.');

    rerender(<AvatarStatus status={null} />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveStyle({ position: 'absolute' });
  });
});
