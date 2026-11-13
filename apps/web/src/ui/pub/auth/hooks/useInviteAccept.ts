import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { readAccountError } from '../../../../lib/accountActionResponses';
import { useAuthApi } from './useAuthApi';
import { translateApiError } from '../../../../lib/apiErrors';
import { clearPendingInvite, readPendingInvite, storePendingInvite } from '../../../../lib/pendingInvite';
export interface InvitePreview {
  tenantName: string;
  role: string;
  status: 'pending' | 'accepted' | 'expired';
  emailMasked: string;
}
interface UseInviteAcceptArgs {
  apiBase: string;
  code: string;
  onRegisterWithInvite?: ((code: string) => void) | undefined;
}
async function readErrorCode(res: Response): Promise<unknown> {
  try {
    return ((await res.json()) as { error?: unknown }).error ?? null;
  } catch {
    return null;
  }
}
export function useInviteAccept({ apiBase, code, onRegisterWithInvite }: UseInviteAcceptArgs) {
  const { t } = useTranslation();
  const { storeDesktopAuthToken } = useAuthApi(apiBase);
  const [state, setState] = useState<'loading' | 'not_found' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const autoAccepted = useRef(false);
  useEffect(() => {
    let cancelled = false;
    autoAccepted.current = false;
    async function load(): Promise<void> {
      const [previewRes, meRes] = await Promise.all([
        fetch(`${apiBase}/public/invites/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ code }),
        }).catch(() => null),
        fetch(`${apiBase}/auth/me`, { credentials: 'include' }).catch(() => null),
      ]);
      if (cancelled) return;
      setLoggedIn(meRes !== null && meRes.status !== 401);
      if (previewRes === null) {
        setError(t('common.error'));
        setState('error');
        return;
      }
      if (previewRes.status === 404) {
        setState('not_found');
        return;
      }
      if (!previewRes.ok) {
        const err = await readErrorCode(previewRes);
        setError(translateApiError(err) || t('common.error'));
        setState('error');
        return;
      }
      setPreview((await previewRes.json().catch(() => null)) as InvitePreview | null);
      setState('ready');
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [apiBase, code, t]);
  const accept = useCallback(async (): Promise<void> => {
    setAccepting(true);
    setAcceptError(null);
    try {
      const res = await fetch(`${apiBase}/invites/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code }),
      }).catch(() => null);
      if (res === null || !res.ok) {
        const status = res === null ? 0 : res.status;
        const error = readAccountError(res === null ? null : await res.json().catch(() => null));
        if (error.code === 'ACCOUNT_LOGIN_REQUIRED') {
          window.location.hash = '#/login';
          return;
        }
        if (error.code === 'EMAIL_VERIFICATION_REQUIRED' || error.code === 'EMAIL_VERIFICATION_BINDING_REQUIRED') {
          storePendingInvite(code);
          window.location.hash = '#/verify-pending';
          return;
        }
        setAcceptError(translateApiError(error.message) || t('common.error'));
        if (status === 400 || status === 403 || status === 404 || error.code === 'invite_unavailable')
          clearPendingInvite();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { token?: string | null };
      clearPendingInvite();
      if (body.token) await storeDesktopAuthToken(body.token);
      window.location.hash = '#/app';
      window.location.reload();
    } finally {
      setAccepting(false);
    }
  }, [apiBase, code, storeDesktopAuthToken, t]);
  useEffect(() => {
    if (autoAccepted.current || state !== 'ready' || !loggedIn) return;
    if (preview?.status !== 'pending' || readPendingInvite() !== code) return;
    autoAccepted.current = true;
    void accept();
  }, [state, loggedIn, preview, code, accept]);
  const goLogin = useCallback((): void => {
    storePendingInvite(code);
    window.location.hash = '#/login';
  }, [code]);
  const goRegister = useCallback((): void => {
    storePendingInvite(code);
    if (onRegisterWithInvite) onRegisterWithInvite(code);
    else window.location.hash = '#/register';
  }, [code, onRegisterWithInvite]);
  return { state, error, preview, loggedIn, accepting, acceptError, accept, goLogin, goRegister };
}
