import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import * as React from 'react';
import { RootProviders } from './providers/RootProviders';
import { AppRoutes } from './routes/AppRoutes';

describe('AppRoot smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <RootProviders>
        <AppRoutes />
      </RootProviders>
    );
    expect(container).toBeTruthy();
  });
});


