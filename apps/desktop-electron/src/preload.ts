import { contextBridge, ipcRenderer } from 'electron';

// Schmale, sichere Bridge. Vorläufig werden keine Node-APIs exponiert.
// TODO(TEST): Bridge-API hat noch keine Unit-Tests; später ergänzen, wenn benötigt.

let cachedApiBase: string | undefined;
// Beim Start Konfiguration laden und als globale Variable verfügbar machen,
// damit die Web-App sie über runtimeConfig lesen kann.
(async () => {
  try {
    const cfg = (await ipcRenderer.invoke('desktop:getConfig')) as { apiBase?: string } | undefined;
    cachedApiBase = cfg?.apiBase;
    try { (window as any).__MEETROPOLIS_API_BASE__ = cachedApiBase; } catch {}
  } catch {
    // still no-op
  }
})();

contextBridge.exposeInMainWorld('desktop', {
  // Optional direkt lesbar für runtimeConfig: anyWin.desktop?.apiBase
  get apiBase(): string | undefined {
    return cachedApiBase;
  },
  getConfig: async (): Promise<{ apiBase?: string }> => {
    try { return (await ipcRenderer.invoke('desktop:getConfig')) as any; } catch { return {}; }
  },
  setConfig: async (cfg: { apiBase?: string }): Promise<boolean> => {
    try { return !!(await ipcRenderer.invoke('desktop:setConfig', cfg)); } catch { return false; }
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


