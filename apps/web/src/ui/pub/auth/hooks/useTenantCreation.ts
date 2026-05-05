import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { RegistrationData } from '../AuthPageRenderer';

interface UseTenantCreationArgs {
  apiBase: string;
  regData: RegistrationData;
  setError: (msg: string | null) => void;
  setSlugError: (msg: string | null) => void;
  setSubmitLoading: (loading: boolean) => void;
  setRegStep: (step: number) => void;
  setRegData: (updater: (prev: RegistrationData) => RegistrationData) => void;
  storeDesktopAuthToken: (token: string) => Promise<void>;
}

function redirectAfterTenantCreate(slug: string) {
  const currentHost = window.location.hostname;
  if ((window as unknown as Record<string, string>).__MEETROPOLIS_API_BASE__) {
    window.location.hash = '#/app';
    return;
  }
  if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
    window.location.hash = '#/app';
    return;
  }
  const protocol = window.location.protocol;
  const baseDomain = currentHost.split('.').slice(-2).join('.');
  window.location.href = `${protocol}//${slug}.${baseDomain}`;
}

export function useTenantCreation({
  apiBase,
  regData,
  setError,
  setSlugError,
  setSubmitLoading,
  setRegStep,
  setRegData,
  storeDesktopAuthToken,
}: UseTenantCreationArgs) {
  const { t } = useTranslation('public');

  return useCallback(async (plan: string) => {
    setSlugError(null);
    setError(null);
    setSubmitLoading(true);
    try {
      const res = await fetch(`${apiBase}/public/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          slug: regData.slug,
          name: regData.teamName,
          email: regData.email,
          password: regData.password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'slug_exists') {
          setSlugError(t('auth.slugExists'));
          setRegStep(2);
          return;
        }
        throw new Error(data.error || t('common.error'));
      }
      if (data.token) {
        await storeDesktopAuthToken(data.token);
      }
      redirectAfterTenantCreate(regData.slug);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSubmitLoading(false);
      setRegData((prev) => ({ ...prev, plan }));
    }
  }, [
    apiBase,
    regData,
    storeDesktopAuthToken,
    t,
    setError,
    setSlugError,
    setSubmitLoading,
    setRegStep,
    setRegData,
  ]);
}
