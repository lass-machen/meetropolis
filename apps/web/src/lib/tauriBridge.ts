// Typen für die existierende Bridge, damit TypeScript nicht meckert
declare global {
  interface Window {
    desktop?: any;
    __TAURI__?: any;
    __MEETROPOLIS_API_BASE__?: string;
    __TAURI_CONFIG_LOADED__?: Promise<void>;
  }
}

interface TauriConfig {
  api_base?: string;
  web_base?: string;
}

// Promise das resolved wenn die Config geladen ist
let configLoadedResolve: () => void;
const configLoadedPromise = new Promise<void>((resolve) => {
  configLoadedResolve = resolve;
});

export function initTauriBridge() {
  // Nur ausführen, wenn wir wirklich in Tauri sind
  if (!window.__TAURI__) {
    configLoadedResolve(); // Sofort resolven wenn nicht in Tauri
    return;
  }

  console.log('[Tauri] Initializing Bridge...');

  // Setze das Promise auf window für andere Module
  window.__TAURI_CONFIG_LOADED__ = configLoadedPromise;

  // Polyfill für window.desktop
  window.desktop = {
    apiBase: null as string | null, // Wird async gesetzt
    // Config via Rust Backend laden
    getConfig: async (): Promise<TauriConfig> => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke('get_config');
      } catch (e) {
        console.error('[Tauri] getConfig failed', e);
        return {};
      }
    },
    setConfig: async (cfg: TauriConfig) => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke('set_config', { config: cfg });
        // Nach dem Setzen auch window.desktop.apiBase aktualisieren
        if (cfg.api_base) {
          window.desktop.apiBase = cfg.api_base;
          window.__MEETROPOLIS_API_BASE__ = cfg.api_base;
        }
        return result;
      } catch (e) {
        console.error('[Tauri] setConfig failed', e);
        return false;
      }
    },
    // URL Validierung kann im Frontend passieren oder via fetch (Tauri erlaubt fetch)
    validateApiUrl: async (url: string) => {
      try {
        // Einfacher Fetch-Test
        const res = await fetch(url + '/health');
        return { valid: res.ok, apiUrl: url };
      } catch {
        return { valid: false, apiUrl: url };
      }
    },
    // WICHTIG: Wir stellen KEIN 'pickDisplaySource' bereit.
    // Das signalisiert dem avManager, dass er NICHT den Electron-Pfad nehmen soll.
    // Stattdessen fällt er auf den Standard-Web-Weg zurück (navigator.mediaDevices.getDisplayMedia).
    // Tauri (WKWebView) unterstützt diesen nativ.
    pickDisplaySource: undefined,
    chooseDisplaySource: undefined,
  };

  // Lade die Config sofort und setze apiBase
  loadConfigAndSetApiBase();

  console.log('[Tauri] Bridge initialized. Running as native app.');
}

async function loadConfigAndSetApiBase() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    console.log('[Tauri] Loading config...');
    const config = await invoke<TauriConfig>('get_config');
    console.log('[Tauri] Config loaded:', JSON.stringify(config));
    if (config.api_base) {
      window.desktop.apiBase = config.api_base;
      window.__MEETROPOLIS_API_BASE__ = config.api_base;
      console.log('[Tauri] API Base set to:', config.api_base);
    } else {
      console.warn('[Tauri] No api_base in config, using default');
    }
  } catch (e) {
    console.error('[Tauri] Failed to load config:', e);
  } finally {
    console.log('[Tauri] Config loading complete, window.__MEETROPOLIS_API_BASE__:', window.__MEETROPOLIS_API_BASE__);
    configLoadedResolve();
  }
}

/**
 * Warte bis die Tauri-Config geladen ist.
 * In Nicht-Tauri-Umgebungen resolved sofort.
 */
export function waitForTauriConfig(): Promise<void> {
  return configLoadedPromise;
}

