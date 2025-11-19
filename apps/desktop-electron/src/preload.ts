import { contextBridge, ipcRenderer } from 'electron';

// Schmale, sichere Bridge. Vorläufig werden keine Node-APIs exponiert.
// TODO(TEST): Bridge-API hat noch keine Unit-Tests; später ergänzen, wenn benötigt.

let cachedApiBase: string | undefined;
try {
  // Synchroner Abruf, damit apiBase SOFORT da ist (vor React-Start)
  cachedApiBase = ipcRenderer.sendSync('desktop:getApiBaseSync');
  try { (window as any).__MEETROPOLIS_API_BASE__ = cachedApiBase; } catch { }
} catch { }

// Polyfill für navigator.mediaDevices.getDisplayMedia im Main-World-Kontext.
// Viele Electron/Chromium-Builds markieren die API als "Not supported".
// Wir ersetzen sie durch einen Wrapper, der desktopCapturer nutzt.
(function injectGetDisplayMediaPolyfill() {
  try {
    const code = `
      (function(){
        try {
          const hasNative = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
          const shouldOverride = !hasNative || typeof navigator.mediaDevices.getDisplayMedia !== 'function';
          // Auch bei vorhandener API überschreiben wir, wenn sie "Not supported" werfen würde – Pauschal-Override ist am robustesten im Electron-Kontext.
          const origGDM = hasNative ? navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices) : null;
          navigator.mediaDevices.getDisplayMedia = async function(constraints){
            try {
              // Versuche native API zuerst; wenn sie existiert und funktioniert, nutze sie.
              if (origGDM) {
                return await origGDM(constraints || { video: true });
              }
            } catch (e) {
              // Fällt unten auf Electron-Fallback zurück
            }
            if (!window.desktop || typeof window.desktop.chooseDisplaySource !== 'function') {
              throw new DOMException('NotSupportedError', 'Not supported');
            }
            // Quelle auswählen (Screen bevorzugen)
            const choice = await window.desktop.chooseDisplaySource({ types: ['screen','window'] });
            if (!choice || !choice.id) {
              throw new DOMException('NotAllowedError', 'User cancelled or no source available');
            }
            const videoOnly = (constraints && constraints.audio === false);
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: choice.id,
                  maxFrameRate: 30
                }
              }
            });
            return stream;
          };
          // Kennzeichne, dass ein Polyfill aktiv ist (für Debugging)
          (navigator.mediaDevices as any).__gdmPolyfilled = true;
        } catch {}
      })();
    `;
    const s = document.createElement('script');
    s.textContent = code;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  } catch { }
})();

contextBridge.exposeInMainWorld('desktop', {
  // Optional direkt lesbar für runtimeConfig: anyWin.desktop?.apiBase
  get apiBase(): string | undefined {
    return cachedApiBase;
  },
  getConfig: async (): Promise<{ apiBase?: string; webBase?: string }> => {
    try { return (await ipcRenderer.invoke('desktop:getConfig')) as any; } catch { return {}; }
  },
  validateApiUrl: async (url: string): Promise<{ valid: boolean; apiUrl: string; webUrl?: string }> => {
    try { return await ipcRenderer.invoke('desktop:validateApiUrl', url); } catch { return { valid: false, apiUrl: url }; }
  },
  setConfig: async (cfg: { apiBase?: string; webBase?: string }): Promise<boolean> => {
    try { return !!(await ipcRenderer.invoke('desktop:setConfig', cfg)); } catch { return false; }
  },
  listDisplaySources: async (opts?: { types?: ('screen' | 'window')[] }): Promise<Array<{ id: string; name: string; type: 'screen' | 'window'; thumbnail?: string }>> => {
    try {
      const types = (opts?.types && opts.types.length > 0) ? opts.types : ['screen', 'window'];
      const sources = await ipcRenderer.invoke('desktop:getSources', { types, thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: true });
      return sources.map((s: any) => ({
        id: s.id,
        name: s.name,
        type: (s.id || '').startsWith('screen:') ? 'screen' : 'window',
        thumbnail: s.thumbnail
      }));
    } catch {
      return [];
    }
  },
  pickDisplaySource: async (opts?: { types?: ('screen' | 'window')[] }): Promise<{ id: string; name: string } | null> => {
    try { return await ipcRenderer.invoke('desktop:pickDisplaySource', opts || {}); } catch { return null; }
  },
  __resolveDisplayPick: (token: string, id: string) => { try { ipcRenderer.send('desktop:pickDisplaySource:resolve:' + token, { id }); } catch { } },
  // Electron-native Auswahl einer Bildschirm-/Fensterquelle.
  // Liefert eine sourceId zurück (für chromeMediaSourceId).
  chooseDisplaySource: async (opts?: { types?: ('screen' | 'window')[] }): Promise<{ id: string; name: string } | null> => {
    try {
      const types = (opts?.types && opts.types.length > 0) ? opts.types : ['screen', 'window'];
      const sources = await ipcRenderer.invoke('desktop:getSources', { types, thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
      // Priorisiere Screens vor Fenstern
      const screen = sources.find((s: any) => s.id.startsWith('screen:')) || sources[0];
      if (!screen) return null;
      return { id: screen.id, name: screen.name };
    } catch {
      return null;
    }
  },
  __setApiBase: (v: string) => {
    try {
      cachedApiBase = v;
      try { (window as any).__MEETROPOLIS_API_BASE__ = v; } catch { }
      ipcRenderer.send('desktop:setApiBase', v);
    } catch { }
  }
});

export { };


