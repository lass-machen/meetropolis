import React from 'react';
import './styles/theme.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProviders } from './app/providers/AppProviders';
// Sentry Browser SDK (optional via VITE_SENTRY_DSN)
try {
  const dsn = (import.meta as any).env?.VITE_SENTRY_DSN as string | undefined;
  if (dsn) {
    (async () => {
      const Sentry = await import('@sentry/browser');
      const Tracing = await import('@sentry/tracing');
      Sentry.init({
        dsn,
        integrations: [new (Tracing as any).BrowserTracing()],
        tracesSampleRate: 0.2,
        environment: (import.meta as any).env?.MODE || 'development'
      });
    })();
  }
} catch {}

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>
);

