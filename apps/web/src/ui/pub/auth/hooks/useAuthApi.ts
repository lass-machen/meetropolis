import { useCallback } from 'react';
import { storeDesktopAuthToken } from '../../../../lib/desktopAuth';
import { logger } from '../../../../lib/logger';
import { translateApiError } from '../../../../lib/apiErrors';
import { AccountActionError, readAccountError } from '../../../../lib/accountActionResponses';
import { useTranslation } from 'react-i18next';

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
            const error = readAccountError(await res.json().catch(() => null));
            const retryAfter = Number(res.headers.get('Retry-After'));
            throw new AccountActionError(
              res.status,
              error.code,
              translateApiError(error.message) || t('common.error'),
              error.retryAfter ?? (retryAfter > 0 ? retryAfter : null),
            );
          }
          return (await res.json().catch(() => ({}))) as unknown;
        } catch (e: unknown) {
          if (e instanceof AccountActionError && (e.status < 500 || e.code?.startsWith('EMAIL_'))) throw e;
          logger.warn('[Auth] Anfrage fehlgeschlagen', (e as Error)?.message);
          lastErr = e;
          // Network / connection error: short retry with backoff
          if (i < attempts.length - 1) {
            await new Promise((r) => setTimeout(r, attempts[i]));
            continue;
          }
          break;
        }
      }
      throw lastErr instanceof AccountActionError ? lastErr : new Error(t('common.networkError'));
    },
    [baseUrl, t],
  );

  return { post, storeDesktopAuthToken };
}
