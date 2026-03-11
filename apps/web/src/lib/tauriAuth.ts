/**
 * Tauri Auth Token Manager
 * Stores and retrieves the auth token for Tauri/native clients
 * that can't use cookies for cross-origin requests.
 */

import { logger } from './logger';

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
      logger.debug('[TauriAuth] Token stored');
    } else {
      localStorage.removeItem(TOKEN_KEY);
      logger.debug('[TauriAuth] Token cleared');
    }
  } catch (e) {
    logger.error('[TauriAuth] Failed to store token:', e);
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

  // Add x-tenant header (only for subdomain-based tenants, not apex domains)
  try {
    const webBase = window.__MEETROPOLIS_WEB_BASE__ || '';
    if (webBase) {
      const hostname = new URL(webBase).hostname;
      const parts = hostname.split('.');
      // Only extract tenant from subdomain (e.g., demo.meetropolis.me → "demo")
      // Apex domains (e.g., meetropolis.me) have < 3 parts → no x-tenant header
      if (parts.length >= 3) {
        headers['x-tenant'] = parts[0];
      }
    }
  } catch {}

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
  logger.debug('[TauriAuth] Fetch interceptor installed');
}
