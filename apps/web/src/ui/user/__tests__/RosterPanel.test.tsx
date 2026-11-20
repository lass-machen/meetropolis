import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RosterPanel } from '../RosterPanel';

describe('RosterPanel labelled region', () => {
  it('uses the team translation as the complementary name in both states', () => {
    const { rerender } = render(<RosterPanel roster={[]} />);

    expect(screen.getByRole('complementary', { name: 'roster.team' })).toBeInTheDocument();

    rerender(<RosterPanel roster={[]} collapsed />);

    expect(screen.getByRole('complementary', { name: 'roster.team' })).toBeInTheDocument();
  });
});
