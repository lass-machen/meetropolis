import { contextBridge, ipcRenderer } from 'electron';

// Schmale, sichere Bridge. Vorläufig werden keine Node-APIs exponiert.
// TODO(TEST): Bridge-API hat noch keine Unit-Tests; später ergänzen, wenn benötigt.

contextBridge.exposeInMainWorld('desktop', {
  getConfig: async (): Promise<{ apiBase?: string }> => {
    try { return (await ipcRenderer.invoke('desktop:getConfig')) as any; } catch { return {}; }
  },
  setConfig: async (cfg: { apiBase?: string }): Promise<boolean> => {
    try { return !!(await ipcRenderer.invoke('desktop:setConfig', cfg)); } catch { return false; }
  },
  __setApiBase: (v: string) => { try { ipcRenderer.send('desktop:setApiBase', v); } catch {} }
});

export {};


