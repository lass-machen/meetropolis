import { useEffect, useRef, useState } from 'react';
import { useAuthApi } from '../../pub/auth/hooks/useAuthApi';
import { AccountActionError, readMailSent, readVerificationDelivery } from '../../../lib/accountActionResponses';

export function useVerificationRequest(apiBase: string, inspectStatus = false) {
  const { post } = useAuthApi(apiBase);
  const [state, setState] = useState<
    'idle' | 'sending' | 'sent' | 'cooldown' | 'failed' | 'loginRequired' | 'adminPending'
  >('idle');
  const actionVersion = useRef(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState(0);
  useEffect(() => {
    if (!inspectStatus) return;
    const controller = new AbortController();
    const version = actionVersion.current;
    void fetch(`${apiBase}/auth/verify/status`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (controller.signal.aborted || version !== actionVersion.current) return;
        if (response.status === 401) {
          setState('loginRequired');
          return;
        }
        const body = (await response.json().catch(() => null)) as {
          status?: unknown;
          pendingDelivery?: unknown;
        } | null;
        if (body?.status === 'admin_pending' || body?.pendingDelivery === 'admin') {
          if (!controller.signal.aborted && version === actionVersion.current) setState('adminPending');
          return;
        }
        const delivery = readVerificationDelivery(body);
        if (!controller.signal.aborted && version === actionVersion.current && delivery)
          setState(
            delivery === 'sent' ? 'sent' : delivery === 'login_required' ? 'loginRequired' : 'failed',
          );
      }).catch(() => { if (!controller.signal.aborted && version === actionVersion.current) setState('failed'); });
    return () => controller.abort();
  }, [apiBase, inspectStatus]);
  useEffect(() => {
    if (state !== 'cooldown') return;
    const timer = setTimeout(() => setState('idle'), retryAfter * 1000);
    return () => clearTimeout(timer);
  }, [state, retryAfter]);
  async function resend() {
    if (state === 'sending' || state === 'cooldown') return;
    actionVersion.current++;
    setErrorMessage(null);
    setState('sending');
    try { setState(readMailSent(await post('/auth/verify/request', {})) ? 'sent' : 'failed'); }
    catch (error: unknown) {
      if (error instanceof AccountActionError && error.code === 'EMAIL_VERIFICATION_BINDING_REQUIRED')
        setErrorMessage(error.message);
      if (error instanceof AccountActionError && error.status === 429) {
        setRetryAfter(error.retryAfter ?? 120);
        setState('cooldown');
      } else setState(error instanceof AccountActionError && error.status === 401 ? 'loginRequired' : 'failed');
    }
  }
  return { state, retryAfter, resend, errorMessage };
}
