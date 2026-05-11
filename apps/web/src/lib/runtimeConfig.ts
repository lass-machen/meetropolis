function stripTrailingSlash(u: string): string {
  return u.replace(/\/+$/g, '');
}

/**
 * Read a numeric Vite env value (milliseconds) with a guaranteed fallback.
 * Accepts both string (from `.env`) and numeric values (from `import.meta.env` overrides in tests).
 * Rejects non-finite or non-positive inputs and returns the fallback in that case.
 */
export function readTimeoutMs(envKey: string, fallbackMs: number): number {
  try {
    const env = import.meta.env as unknown as Record<string, unknown>;
    const raw = env?.[envKey];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  } catch {}
  return fallbackMs;
}

export function getApiBaseFromWindow(): string {
  // 1) Query-Parameter (von Electron gesetzt)
  try {
    const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const qp = sp.get('apiBase');
    if (qp) return stripTrailingSlash(qp);
  } catch {}
  // 2) Desktop-Bridge (zur Laufzeit gesetzt, z.B. via @meetropolis/desktop)
  try {
    const fromDesktop = window?.desktop?.apiBase || window?.__MEETROPOLIS_API_BASE__;
    if (typeof fromDesktop === 'string' && fromDesktop) return stripTrailingSlash(fromDesktop);
  } catch {}
  // 3) Build-time Env (Vite)
  try {
    const env = import.meta.env;
    if (typeof env.VITE_API_BASE === 'string' && env.VITE_API_BASE) return stripTrailingSlash(env.VITE_API_BASE);
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
