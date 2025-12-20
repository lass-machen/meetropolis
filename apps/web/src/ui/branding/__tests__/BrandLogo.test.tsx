import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrandLogo } from '../BrandLogo';

describe('BrandLogo', () => {
  it('renders with default src and alt', () => {
    render(<BrandLogo />);
    const img = screen.getByAltText('Logo') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toContain('/brand/logo.png');
    expect(img.getAttribute('width')).toBe('32');
    expect(img.getAttribute('height')).toBe('32');
  });

  it('allows overriding src, alt and size', () => {
    render(<BrandLogo src="/brand/custom.png" alt="Custom" size={40} />);
    const img = screen.getByAltText('Custom') as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('/brand/custom.png');
    expect(img.getAttribute('width')).toBe('40');
    expect(img.getAttribute('height')).toBe('40');
  });

  it('hides image when it fails to load', () => {
    render(<BrandLogo />);
    const img = screen.getByAltText('Logo') as HTMLImageElement;
    fireEvent.error(img);
    expect(screen.queryByAltText('Logo')).toBeNull();
  });
});


