// WICHTIG: WebSocket Patch MUSS als erstes importiert werden!
// Colyseus cached WebSocket auf Modul-Ebene, daher muss der Patch
// vor allen anderen Imports passieren.
import './lib/patchWebSocket';

import React from 'react';
import './styles/theme.css';
import { createRoot } from 'react-dom/client';
import { AppRoutes } from './app/routes/AppRoutes';
import { RootProviders } from './app/providers/RootProviders';
import { initTauriBridge, waitForTauriConfig } from './lib/tauriBridge';
// Import tauriAuth to install fetch interceptor early
import './lib/tauriAuth';

// Initialize Tauri Bridge if available
initTauriBridge();

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

// Warte auf Tauri Config bevor wir rendern (wichtig für apiBase)
waitForTauriConfig().then(() => {
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <React.StrictMode>
      <RootProviders>
        <AppRoutes />
      </RootProviders>
    </React.StrictMode>
  );
});
