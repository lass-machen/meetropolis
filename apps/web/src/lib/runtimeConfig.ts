function stripTrailingSlash(u: string): string {
  return u.replace(/\/+$/g, '');
}

export function getApiBaseFromWindow(): string {
  // 1) Query-Parameter (von Electron gesetzt)
  try {
    const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const qp = sp.get('apiBase');
    if (qp) return stripTrailingSlash(qp);
  } catch {}
  // 2) Desktop-Bridge (zur Laufzeit gesetzt)
  try {
    const anyWin = (window as any) || {};
    const fromDesktop = anyWin.desktop?.apiBase || anyWin.__MEETROPOLIS_API_BASE__;
    if (typeof fromDesktop === 'string' && fromDesktop) return stripTrailingSlash(fromDesktop);
  } catch {}
  // 2.5) Tauri Fallback: wenn wir in Tauri sind aber kein apiBase gesetzt ist,
  //       nutze die Production-Default statt den Browser-Host
  try {
    if ((window as any).__TAURI__) {
      return 'https://api.meetropolis.me';
    }
  } catch {}
  // 3) Build-time Env (Vite)
  try {
    const env: any = (import.meta as any).env || {};
    if (typeof env.VITE_API_BASE === 'string' && env.VITE_API_BASE) return stripTrailingSlash(String(env.VITE_API_BASE));
  } catch {}
  // 4) Browser-Host Fallback (Dev/Browser)
  try {
    const proto = typeof window !== 'undefined' ? window.location.protocol : 'http:';
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    return stripTrailingSlash(`${proto}//${host}:2567`);
  } catch {}
  // 5) Final Fallback
  return 'http://localhost:2567';
}


