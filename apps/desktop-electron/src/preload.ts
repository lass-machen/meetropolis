import { contextBridge, ipcRenderer, desktopCapturer } from 'electron';

// Schmale, sichere Bridge. Vorläufig werden keine Node-APIs exponiert.
// TODO(TEST): Bridge-API hat noch keine Unit-Tests; später ergänzen, wenn benötigt.

let cachedApiBase: string | undefined;
try {
  // Synchroner Abruf, damit apiBase SOFORT da ist (vor React-Start)
  cachedApiBase = ipcRenderer.sendSync('desktop:getApiBaseSync');
  try { (window as any).__MEETROPOLIS_API_BASE__ = cachedApiBase; } catch {}
} catch {}

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
  // Electron-native Auswahl einer Bildschirm-/Fensterquelle.
  // Liefert eine sourceId zurück (für chromeMediaSourceId).
  chooseDisplaySource: async (opts?: { types?: ('screen'|'window')[] }): Promise<{ id: string; name: string } | null> => {
    try {
      const types = (opts?.types && opts.types.length > 0) ? opts.types : ['screen', 'window'];
      const sources = await desktopCapturer.getSources({ types, thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false } as any);
      // Priorisiere Screens vor Fenstern
      const screen = sources.find(s => s.id.startsWith('screen:')) || sources[0];
      if (!screen) return null;
      return { id: screen.id, name: screen.name };
    } catch {
      return null;
    }
  },
  __setApiBase: (v: string) => {
    try {
      cachedApiBase = v;
      try { (window as any).__MEETROPOLIS_API_BASE__ = v; } catch {}
      ipcRenderer.send('desktop:setApiBase', v);
    } catch {}
  }
});

export {};


