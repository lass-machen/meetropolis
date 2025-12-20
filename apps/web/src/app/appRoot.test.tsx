import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RootProviders } from './providers/RootProviders';

describe('AppRoot smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <RootProviders>
        <div data-testid="smoke" />
      </RootProviders>
    );
    expect(container).toBeTruthy();
  });
});

