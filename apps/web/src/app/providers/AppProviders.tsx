import * as React from 'react';
import { ThemeProvider } from '../../ui/theme';
import { I18nProvider } from './I18nProvider';

// No cookie-consent banner is rendered in any build: the app sets only
// session/auth cookies, which under §25 (3) TTDSG / Art. 5 (3) ePrivacy are
// technically necessary and do not require explicit consent. Analytics consent
// (in builds that ship the optional telemetry module) is governed centrally by
// that module's backend settings, not by any app-side banner.

export function AppProviders(props: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <ThemeProvider>{props.children}</ThemeProvider>
    </I18nProvider>
  );
}
