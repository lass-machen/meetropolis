// IMPORTANT: WebSocket patch MUST be imported first!
// Colyseus caches WebSocket at module level, so the patch
// must run before all other imports.
import './lib/patchWebSocket';

import React from 'react';
import './styles/theme.css';
import './styles/system.css';
import './styles/public.css';
import { createRoot } from 'react-dom/client';
import { AppRoutes } from './app/routes/AppRoutes';
import { RootProviders } from './app/providers/RootProviders';
import { getDesktopModule } from './lib/desktopLoader';
import { getTelemetryModule } from './lib/telemetryLoader';
import { setAudioDuckingPreference } from './av/audio/audioSessionDucking';

// Load and initialise the desktop module (if available)
async function initAndRender() {
  const desktop = await getDesktopModule();
  if (desktop) {
    desktop.initDesktop();
    await desktop.waitForConfig();

    // Apply the persisted native audio-ducking preference to the web audio
    // session at launch, before any capture session starts. Without this,
    // WKWebView defaults to a voice-chat session type and ducks other apps on
    // every launch regardless of the saved setting. Best-effort: on failure the
    // ducking layer just stays at the WebKit default.
    try {
      const duckEnabled = await desktop.getAudioDucking?.();
      if (typeof duckEnabled === 'boolean') setAudioDuckingPreference(duckEnabled);
    } catch {
      /* leave the audio session at its default */
    }
  }

  // Initialise browser telemetry (if the closed-source module is present).
  // Absent in every OSS build → getTelemetryModule() returns null → no-op.
  // Wrapped so a telemetry failure can never block the app boot.
  try {
    const telemetry = await getTelemetryModule();
    await telemetry?.initTelemetry();
  } catch {
    // Telemetry is best-effort; swallow any init error.
  }

  const root = createRoot(document.getElementById('root')!);
  root.render(
    <React.StrictMode>
      <RootProviders>
        <AppRoutes />
      </RootProviders>
    </React.StrictMode>,
  );
}

void initAndRender();
