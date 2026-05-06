// WICHTIG: WebSocket Patch MUSS als erstes importiert werden!
// Colyseus cached WebSocket auf Modul-Ebene, daher muss der Patch
// vor allen anderen Imports passieren.
import './lib/patchWebSocket';

import React from 'react';
import './styles/theme.css';
import './styles/system.css';
import './styles/public.css';
import { createRoot } from 'react-dom/client';
import { AppRoutes } from './app/routes/AppRoutes';
import { RootProviders } from './app/providers/RootProviders';
import { getDesktopModule } from './lib/desktopLoader';
import { applyAudioDuckingPreference } from './av/audio/audioSessionDucking';

// Audio ducking preference (Tauri desktop only)
window.addEventListener('desktop:audio-ducking-changed', (e) => {
  const { enabled } = (e as CustomEvent<{ enabled: boolean }>).detail;
  applyAudioDuckingPreference(enabled);
});

// Desktop-Modul laden und initialisieren (falls vorhanden)
async function initAndRender() {
  const desktop = await getDesktopModule();
  if (desktop) {
    desktop.initDesktop();
    await desktop.waitForConfig();
  }

  // Sentry Browser SDK (optional via VITE_SENTRY_DSN)
  try {
    const dsn = (import.meta as any).env?.VITE_SENTRY_DSN as string | undefined;
    if (dsn) {
      const Sentry = await import('@sentry/browser');
      Sentry.init({
        dsn,
        integrations: [Sentry.browserTracingIntegration()],
        tracesSampleRate: 0.2,
        environment: (import.meta as any).env?.MODE || 'development'
      });
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
}

initAndRender();
