import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../theme';
import { ThemeToggleButton } from '../theme';

describe('ThemeToggleButton', () => {
  it('toggles data-theme on documentElement', () => {
    render(
      <ThemeProvider>
        <ThemeToggleButton />
      </ThemeProvider>
    );
    const darkBtn = screen.getByTitle('Dunkles Design');
    fireEvent.click(darkBtn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    const systemBtn = screen.getByTitle('Systemeinstellung');
    fireEvent.click(systemBtn);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});


