import React from 'react';
import './styles/theme.css';
import { createRoot } from 'react-dom/client';
import { AppRoutes } from './app/routes/AppRoutes';
import { RootProviders } from './app/providers/RootProviders';
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

// Filter noisy framework logs in non-debug mode
try {
  const allowDebug = (window as any).DEBUG_LOGS || (import.meta as any).env?.VITE_DEBUG_LOGS === 'true';
  if (!allowDebug) {
    const prevLog = console.log;
    const prevInfo = console.info;
    const prevWarn = console.warn;
    const prevError = console.error;
    console.log = (...args: any[]) => {
      try {
        if (typeof args[0] === 'string') {
          if (/^SPEICHERN!/.test(args[0])) return;
          if (/Phaser v\d/i.test(args[0])) return;
        }
      } catch {}
      return (prevLog as any).apply(console, args as any);
    };
    console.info = (...args: any[]) => {
      try {
        if (typeof args[0] === 'string') {
          if (/^SPEICHERN!/.test(args[0])) return;
          if (/Download the React DevTools/i.test(args[0])) return;
        }
      } catch {}
      return (prevInfo as any).apply(console, args as any);
    };
    console.warn = (...args: any[]) => {
      try {
        if (typeof args[0] === 'string') {
          if (/^SPEICHERN!/.test(args[0])) return;
          if (/Download the React DevTools/i.test(args[0])) return;
        }
      } catch {}
      return (prevWarn as any).apply(console, args as any);
    };
    console.error = (...args: any[]) => {
      try { if (typeof args[0] === 'string' && /Tilemap has no tileset/i.test(args[0])) return; } catch {}
      return (prevError as any).apply(console, args as any);
    };
  }
} catch {}

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <RootProviders>
      <AppRoutes />
    </RootProviders>
  </React.StrictMode>
);

