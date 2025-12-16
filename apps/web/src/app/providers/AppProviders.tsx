import * as React from 'react';
import { ThemeProvider } from '../../ui/theme';
import { I18nProvider } from './I18nProvider';
import { CookieConsent } from '../../ui/legal/CookieConsent';

export function AppProviders(props: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <ThemeProvider>
        {props.children}
        <CookieConsent />
      </ThemeProvider>
    </I18nProvider>
  );
}


