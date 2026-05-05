import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrandWordmark } from '../BrandWordmark';

describe('BrandWordmark', () => {
  it('renders with default src and alt', () => {
    render(<BrandWordmark />);
    const img = screen.getByAltText('Meetropolis') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toContain('/brand/wordmark.png');
    expect(img.getAttribute('height')).toBe('20');
  });

  it('renders fallback when image fails to load', () => {
    render(<BrandWordmark renderFallback={() => <span>Meetropolis</span>} />);
    const img = screen.getByAltText('Meetropolis') as HTMLImageElement;
    fireEvent.error(img);
    expect(screen.getByText('Meetropolis')).toBeTruthy();
  });
});


