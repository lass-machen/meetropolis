import { useCallback } from 'react';
import { getDesktopModule } from '../../../../lib/desktopLoader';
import { logger } from '../../../../lib/logger';
import { translateApiError } from '../../../../lib/apiErrors';
import { useTranslation } from 'react-i18next';

async function storeDesktopAuthToken(token: string) {
  try {
    const desktop = await getDesktopModule();
    if (desktop) desktop.setDesktopAuthToken(token);
  } catch {
    /* ignore */
  }
}

export function useAuthApi(baseUrl: string) {
  const { t } = useTranslation();

  const post = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      const url = `${baseUrl}${path}`;
      logger.debug('[Auth] POST to:', url);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Desktop clients (Tauri): extract the x-tenant header from web_base
      try {
        const webBase = (window as unknown as Record<string, string>).__MEETROPOLIS_WEB_BASE__ || '';
        if (webBase) {
          const hostname = new URL(webBase).hostname;
          const parts = hostname.split('.');
          if (parts.length >= 3) {
            headers['x-tenant'] = parts[0];
            logger.debug('[Auth] Setting x-tenant header:', parts[0]);
          }
        }
      } catch {
        /* ignore */
      }

      let lastErr: unknown = null;
      const attempts = [200, 500, 1000];

      for (let i = 0; i < attempts.length; i++) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const errBody = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(translateApiError(errBody.error) || t('common.error'));
          }
          return (await res.json().catch(() => ({}))) as unknown;
        } catch (e: unknown) {
          logger.warn('[Auth] Fetch error:', (e as Error)?.message || String(e), 'URL:', url);
          lastErr = e;
          // Network / connection error: short retry with backoff
          if (i < attempts.length - 1) {
            await new Promise((r) => setTimeout(r, attempts[i]));
            continue;
          }
          break;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(t('common.networkError'));
    },
    [baseUrl, t],
  );

  return { post, storeDesktopAuthToken };
}
