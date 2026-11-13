import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AvatarStatus } from './AvatarStatus';

/**
 * Die Statusregion muss schon ohne Meldung im DOM stehen (ARIA22: der Container
 * muss vor der Meldung existieren), damit eine spätere Meldung überhaupt
 * angekündigt werden kann.
 */
describe('AvatarStatus', () => {
  it('hält die Statusregion ohne Meldung vorhanden und leer', () => {
    render(<AvatarStatus status={null} />);

    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveAttribute('aria-atomic', 'true');

    // Die leere Region wird nicht versteckt: display:none, hidden,
    // visibility:hidden und aria-hidden würden sie aus dem
    // Accessibility-Baum nehmen. Stattdessen steht sie absolut, damit sie
    // keinen Platz im Flexfluss belegt.
    expect(region).not.toHaveAttribute('hidden');
    expect(region).not.toHaveAttribute('aria-hidden');
    expect(region).not.toHaveStyle({ display: 'none' });
    expect(region).not.toHaveStyle({ visibility: 'hidden' });
    expect(region).toHaveStyle({ position: 'absolute' });
  });

  it('nimmt Meldung und Textwechsel im selben Knoten auf und leert ihn wieder', () => {
    const { rerender } = render(<AvatarStatus status={null} />);
    const region = screen.getByRole('status');

    rerender(<AvatarStatus status="Avatar gespeichert." />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('Avatar gespeichert.');

    // Mit Text steht die Region wieder im Flexfluss.
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
