import { app, BrowserWindow, session, ipcMain, Menu } from 'electron';
import path from 'path';
import url from 'url';
import fs from 'fs/promises';

// TODO(TEST): Minimaler Desktop-Smoke-Test fehlt (Window-Start, Dev/Prod-Ladepfad)

let globalApiBase: string | undefined; // Memory cache for sync IPC
let globalWebBase: string | undefined;  // Remote Web UI base (e.g., https://meetropolis.example.com)

const isDev = !app.isPackaged;
type AppConfig = { apiBase?: string; webBase?: string };
function getConfigPath(): string { return path.join(app.getPath('userData'), 'config.json'); }
async function readConfig(): Promise<AppConfig> {
  try {
    const p = getConfigPath();
    const raw = await fs.readFile(p, 'utf-8');
    return JSON.parse(raw) as AppConfig;
  } catch {
    return {};
  }
}
async function writeConfig(cfg: AppConfig): Promise<void> {
  const p = getConfigPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(cfg, null, 2), 'utf-8');
}

function getPreloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

function getIndexUrl(apiBase?: string): string {
  if (isDev) {
    return 'http://localhost:5173';
  }
  // In Produktion: Wenn eine Web-URL konfiguriert ist, laden wir direkt diese Remote-URL.
  // So ist die Desktop-App 1:1 identisch mit der Browser-Version.
  if (globalWebBase && /^https?:\/\//.test(globalWebBase)) {
    return globalWebBase;
  }
  // Notfall: aus apiBase eine Web-URL ableiten (api.foo -> foo)
  if (apiBase && /^https?:\/\//.test(apiBase)) {
    try {
      const u = new URL(apiBase);
      const host = u.hostname.startsWith('api.') ? u.hostname.slice('api.'.length) : u.hostname;
      u.hostname = host;
      u.pathname = '/';
      return u.toString().replace(/\/+$/g, '');
    } catch {}
  }
  // Fallback: Lokales HTML für Setup/Error
  const indexPath = path.join(process.resourcesPath, 'web', 'index.html');
  return url.pathToFileURL(indexPath).toString();
}

function withApiBase(u: string, apiBase?: string): string {
  // Wenn wir die Remote-URL direkt laden, brauchen wir den Query-Param nicht zwingend,
  // hängen ihn aber zur Sicherheit an (für Hybrid-Setups).
  if (!apiBase) return u;
  // Wenn u == apiBase, nichts anhängen
  if (u.replace(/\/$/, '') === apiBase.replace(/\/$/, '')) return u;
  
  try {
    const parsed = new URL(u);
    parsed.searchParams.set('apiBase', apiBase);
    return parsed.toString();
  } catch {
    return u + (u.includes('?') ? '&' : '?') + `apiBase=${encodeURIComponent(apiBase)}`;
  }
}

async function createMainWindow(apiBase?: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Meetropolis',
    show: false, // Erst zeigen wenn geladen
    backgroundColor: '#111',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      webSecurity: !isDev
    }
  });

  const startUrl = withApiBase(getIndexUrl(apiBase), apiBase);
  // Wenn Remote: User-Agent anpassen, falls Server Weichen stellt
  if (startUrl.startsWith('http')) {
    win.webContents.setUserAgent(win.webContents.getUserAgent() + ' MeetropolisDesktop/0.1.0');
  }

  win.once('ready-to-show', () => win.show());

  try {
    await win.loadURL(startUrl);
  } catch (e) {
    // Falls Remote-Load fehlschlägt (Offline?), lokalen Dialog zeigen
    if (startUrl !== getIndexUrl(undefined)) {
       await win.loadURL(getIndexUrl(undefined));
    }
  }

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  return win;
}

function setAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Server wechseln…',
          click: async () => {
            const v = await promptForApiBase(globalApiBase);
            if (!v) return;
            // webBase aus apiBase ableiten, falls unbekannt
            const webFromApi = (() => {
              try {
                const u = new URL(v);
                const host = u.hostname.startsWith('api.') ? u.hostname.slice('api.'.length) : u.hostname;
                u.hostname = host;
                u.pathname = '/';
                return u.toString().replace(/\/+$/g, '');
              } catch { return globalWebBase; }
            })();
            try { await writeConfig({ apiBase: v, webBase: webFromApi }); globalApiBase = v; globalWebBase = webFromApi; } catch {}
            const all = BrowserWindow.getAllWindows();
            const win = all[0];
            if (win) {
              const startUrl = withApiBase(getIndexUrl(v), v);
              await win.loadURL(startUrl);
            } else {
              await createMainWindow(v);
            }
          }
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function promptForApiBase(currentValue?: string): Promise<string | undefined> {
  return await new Promise<string | undefined>((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 260,
      resizable: false,
      title: 'Meetropolis – Server verbinden',
      modal: true,
      parent: BrowserWindow.getFocusedWindow() || undefined,
      webPreferences: {
        preload: getPreloadPath(),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    });
    const safeValue = (currentValue || 'http://localhost:2567').replace(/'/g, "\\'");
    const html = `<!doctype html>
      <html>
        <head>
          <meta charset=\"utf-8\" />
          <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />
          <title>Meetropolis – Server</title>
          <style>
            body{font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin:0;padding:20px;color:#111}
            h1{margin:0 0 8px 0;font-size:18px}
            p{margin:4px 0 14px 0;color:#444}
            input{width:100%;padding:10px 12px;border:1px solid #ccc;border-radius:8px;font-size:14px}
            .row{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
            button{appearance:none;border:0;border-radius:8px;padding:8px 14px;font-weight:600;background:#0b5; color:white;cursor:pointer}
            button[variant=secondary]{background:#ddd;color:#111}
          </style>
        </head>
        <body>
          <h1>Server verbinden</h1>
          <p>Bitte gib die Basis-URL deines Meetropolis-Servers an (z. B. https://meetropolis.example.com oder http://localhost:2567).</p>
          <input id=\"api\" placeholder=\"http://localhost:2567\" />
          <div class=\"row\">
            <button variant=\"secondary\" id=\"cancel\">Abbrechen</button>
            <button id=\"save\">Verbinden</button>
          </div>
          <script>
            const $ = (s)=>document.querySelector(s);
            const apiInp = $('#api');
            const saveBtn = $('#save');
            const cancelBtn = $('#cancel');

            apiInp.value = '${safeValue}';
            apiInp.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ saveBtn.click(); }});
            
            cancelBtn.onclick = ()=>{ window.close(); };
            
            saveBtn.onclick = async ()=>{
              const v = String(apiInp.value||'').trim();
              if(!v){ alert('Bitte eine URL eingeben'); return; }
              
              saveBtn.disabled = true;
              apiInp.disabled = true;
              const originalText = saveBtn.innerText;
              saveBtn.innerText = 'Prüfe…';
              
              try {
                // Validate & Auto-Discover API + Web URL
                const res = await window.desktop.validateApiUrl(v);
                if (res.valid) {
                  const cfg = { apiBase: (res.apiUrl||'').replace(/\\/+$/,''), webBase: (res.webUrl||'').replace(/\\/+$/,'') };
                  await window.desktop.setConfig(cfg);
                  saveBtn.innerText = 'Verbunden!';
                  saveBtn.style.background = '#10b981';
                  setTimeout(() => {
                    // Inform main to close dialog and continue
                    window.desktop && window.desktop.__setApiBase && window.desktop.__setApiBase(cfg.apiBase);
                  }, 400);
                } else {
                  alert('Unter dieser URL konnte kein Meetropolis-Server gefunden werden.\\n\\nBitte prüfe die Adresse.');
                  saveBtn.disabled = false;
                  apiInp.disabled = false;
                  saveBtn.innerText = originalText;
                  apiInp.focus();
                }
              } catch (e) {
                alert('Fehler beim Prüfen der URL.');
                saveBtn.disabled = false;
                apiInp.disabled = false;
                saveBtn.innerText = originalText;
              }
            };
          </script>
        </body>
      </html>`;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    ipcMain.once('desktop:setApiBase', async (_evt, v: string) => {
      try { await writeConfig({ apiBase: v }); globalApiBase = v; } catch {}
      try { win.close(); } catch {}
      resolve(v);
    });
    win.on('closed', () => resolve(undefined));
  });
}

function registerSecurityHandlers(): void {
  // Permissions: media (Kamera/Mikro) & screen-capture (DisplayCapture)
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') {
      callback(true);
      return;
    }
    callback(false);
  });

  // Einfache CSP zur Härtung (anpassbar bei Bedarf)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = [
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: http:",
      "img-src 'self' data: blob: https: http:",
      "media-src 'self' blob: https: http:",
      "connect-src 'self' ws: wss: https: http:"
    ].join('; ');
    const responseHeaders = {
      ...details.responseHeaders,
      'Content-Security-Policy': [csp],
      // Erlaube getDisplayMedia im Top-Level-Dokument explizit
      'Permissions-Policy': ["display-capture=(self)"],
      // Legacy alias (einige Stacks nutzen noch diese Bezeichnung)
      'Feature-Policy': ["display-capture 'self'"]
    } as Record<string, string[]>;
    callback({ responseHeaders });
  });
}

function configureGpu(): void {
  // WebGL Stabilität verbessern; Metal bevorzugen
  app.commandLine.appendSwitch('use-angle', 'metal');
}

app.whenReady().then(async () => {
  configureGpu();
  registerSecurityHandlers();
  setAppMenu();
  // IPC für Setup-Dialog
  ipcMain.handle('desktop:getConfig', async () => await readConfig());
  ipcMain.handle('desktop:validateApiUrl', async (_evt, inputUrl: string) => {
    const normalize = (u: string) => u.replace(/\/+$/, '').trim();
    let url = normalize(inputUrl);
    if (!url.startsWith('http')) url = 'https://' + url;

    const check = async (u: string) => {
      try {
        const res = await fetch(u + '/health');
        if (res.ok) {
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) return true;
          // Fallback: try parsing json
          try { const json = await res.json(); return !!json; } catch { return false; }
        }
      } catch {}
      return false;
    };

    // 1. Try as is (assume user entered API URL)
    if (await check(url)) {
      let webUrl = '';
      try {
        const u = new URL(url);
        const host = u.hostname.startsWith('api.') ? u.hostname.slice('api.'.length) : u.hostname;
        u.hostname = host;
        u.pathname = '/';
        webUrl = normalize(u.toString());
      } catch {}
      return { valid: true, apiUrl: url, webUrl };
    }

    // 2. Try adding 'api.' prefix to hostname if not present
    try {
      const u = new URL(url);
      if (!u.hostname.startsWith('api.')) {
        const originalHost = u.hostname;
        u.hostname = 'api.' + u.hostname;
        const apiUrl = normalize(u.toString());
        if (await check(apiUrl)) {
          // If original was web host, keep it as webUrl
          const webUrl = normalize(url);
          return { valid: true, apiUrl, webUrl };
        }
      }
    } catch {}

    return { valid: false, apiUrl: inputUrl, webUrl: '' };
  });
  ipcMain.on('desktop:getApiBaseSync', (evt) => { evt.returnValue = globalApiBase; });
  ipcMain.handle('desktop:setConfig', async (_evt, cfg: AppConfig) => { await writeConfig(cfg||{}); return true; });
  ipcMain.on('desktop:setApiBase', (_evt, v: string) => { 
    globalApiBase = v; 
    // try to keep web base in sync if missing
    if (!globalWebBase && v) {
      try { const u = new URL(v); const host = u.hostname.startsWith('api.') ? u.hostname.slice('api.'.length) : u.hostname; u.hostname = host; u.pathname = '/'; globalWebBase = u.toString().replace(/\/+$/,''); } catch {}
    }
    /* handled in prompt, but also update memory */ 
  });

  let cfg = await readConfig();
  let apiBase = cfg.apiBase;
  globalWebBase = cfg.webBase || globalWebBase || (apiBase ? (() => { try { const u = new URL(apiBase); const host = u.hostname.startsWith('api.') ? u.hostname.slice('api.'.length) : u.hostname; u.hostname = host; u.pathname = '/'; return u.toString().replace(/\/+$/,''); } catch { return undefined; } })() : undefined);
  globalApiBase = apiBase; // Init global var
  if (!apiBase) {
    apiBase = await promptForApiBase();
    globalApiBase = apiBase;
  }
  await createMainWindow(apiBase);

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


