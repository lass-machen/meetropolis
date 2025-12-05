/**
 * Tauri Auth Token Manager
 * Stores and retrieves the auth token for Tauri/native clients
 * that can't use cookies for cross-origin requests.
 */

const TOKEN_KEY = 'meetropolis_auth_token';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI__;
}

export function getTauriAuthToken(): string | null {
  if (!isTauri()) return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setTauriAuthToken(token: string | null): void {
  if (!isTauri()) return;
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      console.log('[TauriAuth] Token stored');
    } else {
      localStorage.removeItem(TOKEN_KEY);
      console.log('[TauriAuth] Token cleared');
    }
  } catch (e) {
    console.error('[TauriAuth] Failed to store token:', e);
  }
}

export function clearTauriAuthToken(): void {
  setTauriAuthToken(null);
}

/**
 * Get headers for API requests in Tauri
 * Adds Authorization header if token is available
 */
export function getTauriAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  if (!isTauri()) return headers;

  // Add x-tenant header
  const webBase = window.__MEETROPOLIS_WEB_BASE__ || '';
  const match = webBase.match(/https?:\/\/([^.]+)\./);
  if (match?.[1]) {
    headers['x-tenant'] = match[1];
  }

  // Add Authorization header
  const token = getTauriAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Tauri-aware fetch wrapper
 * Automatically adds auth headers for Tauri clients
 */
export async function tauriFetch(url: string, init?: RequestInit): Promise<Response> {
  const tauriHeaders = getTauriAuthHeaders();
  const hasHeaders = Object.keys(tauriHeaders).length > 0;

  if (!hasHeaders) {
    return fetch(url, init);
  }

  const mergedInit: RequestInit = {
    ...init,
    headers: {
      ...tauriHeaders,
      ...(init?.headers || {}),
    },
  };

  return fetch(url, mergedInit);
}

// Install global fetch interceptor for Tauri
if (isTauri() && typeof window !== 'undefined') {
  const originalFetch = window.fetch;
  window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Only intercept API requests to our backend
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const apiBase = window.__MEETROPOLIS_API_BASE__ || '';

    if (apiBase && url.startsWith(apiBase)) {
      const tauriHeaders = getTauriAuthHeaders();
      const mergedInit: RequestInit = {
        ...init,
        headers: {
          ...tauriHeaders,
          ...(init?.headers || {}),
        },
      };
      return originalFetch.call(window, input, mergedInit);
    }

    return originalFetch.call(window, input, init);
  };
  console.log('[TauriAuth] Fetch interceptor installed');
}
