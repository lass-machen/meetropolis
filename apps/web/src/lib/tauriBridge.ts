import { invoke } from '@tauri-apps/api/core';

// Typen für die existierende Bridge, damit TypeScript nicht meckert
declare global {
  interface Window {
    desktop?: any;
    __TAURI__?: any;
  }
}

export function initTauriBridge() {
  // Nur ausführen, wenn wir wirklich in Tauri sind
  if (!window.__TAURI__) return;

  console.log('[Tauri] Initializing Bridge...');

  // Polyfill für window.desktop
  window.desktop = {
    // Config via Rust Backend laden
    getConfig: async () => {
      try {
        return await invoke('get_config');
      } catch (e) {
        console.error('[Tauri] getConfig failed', e);
        return {};
      }
    },
    setConfig: async (cfg: any) => {
      try {
        return await invoke('set_config', { config: cfg });
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

  console.log('[Tauri] Bridge initialized. Running as native app.');
}

