import * as React from 'react';
import { ThemeProvider } from '../../ui/theme';

export function AppProviders(props: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      {props.children}
    </ThemeProvider>
  );
}


