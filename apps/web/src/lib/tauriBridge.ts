// Typen für die existierende Bridge, damit TypeScript nicht meckert
declare global {
  interface Window {
    desktop?: any;
    __TAURI__?: any;
    __MEETROPOLIS_API_BASE__?: string;
    __MEETROPOLIS_WEB_BASE__?: string;
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

/**
 * Patch WebSocket for WKWebView compatibility.
 *
 * The problem: Colyseus.js tries to pass an options object to WebSocket:
 *   new WebSocket(url, { headers, protocols })
 *
 * In Node.js this works, in Chrome it throws an error and falls back.
 * But in WKWebView (Safari/Tauri), it doesn't throw - it converts the object
 * to string "[object Object]" which becomes an invalid protocol.
 *
 * This patch wraps WebSocket to handle the case where the second argument
 * is an object instead of an array of protocols.
 */
function patchWebSocketForWKWebView() {
  if (typeof window === 'undefined' || !window.__TAURI__) return;

  const OriginalWebSocket = window.WebSocket;

  // @ts-ignore - we're patching the global WebSocket
  window.WebSocket = function PatchedWebSocket(url: string, protocols?: string | string[] | Record<string, any>) {
    // If protocols is an object (not array, not string), extract the protocols array
    if (protocols && typeof protocols === 'object' && !Array.isArray(protocols)) {
      console.log('[Tauri WebSocket Patch] Converting object to protocols array:', protocols);
      const actualProtocols = (protocols as any).protocols;
      if (Array.isArray(actualProtocols)) {
        return new OriginalWebSocket(url, actualProtocols);
      } else {
        // No protocols specified, just connect without
        return new OriginalWebSocket(url);
      }
    }
    // Normal case - pass through
    return new OriginalWebSocket(url, protocols as string | string[] | undefined);
  } as any;

  // Copy static properties
  (window.WebSocket as any).CONNECTING = OriginalWebSocket.CONNECTING;
  (window.WebSocket as any).OPEN = OriginalWebSocket.OPEN;
  (window.WebSocket as any).CLOSING = OriginalWebSocket.CLOSING;
  (window.WebSocket as any).CLOSED = OriginalWebSocket.CLOSED;

  // Preserve prototype chain for instanceof checks
  window.WebSocket.prototype = OriginalWebSocket.prototype;

  console.log('[Tauri] WebSocket patched for WKWebView compatibility');
}

export function initTauriBridge() {
  // Nur ausführen, wenn wir wirklich in Tauri sind
  if (!window.__TAURI__) {
    configLoadedResolve(); // Sofort resolven wenn nicht in Tauri
    return;
  }

  console.log('[Tauri] Initializing Bridge...');

  // WICHTIG: WebSocket patchen BEVOR irgendwas geladen wird
  // Dies behebt Kompatibilitätsprobleme mit Colyseus in WKWebView
  patchWebSocketForWKWebView();

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
    if (config.web_base) {
      window.__MEETROPOLIS_WEB_BASE__ = config.web_base;
      console.log('[Tauri] Web Base set to:', config.web_base);
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

