import { useCallback } from 'react';
import { useAuthHandlers, type AuthViewName } from './useAuthHandlers';
import { useDebugAutoLogin, useGuestAutoLogin, useRedirectWhenRegistrationDisabled } from './useAuthSideEffects';
import { useAuthPageState } from './useAuthPageState';
import { useTenantCreation } from './useTenantCreation';

export interface UseAuthPageArgs {
  apiBase: string;
  initialView: AuthViewName;
  initialInvite: string | undefined;
  initialGuestToken: string | undefined;
  registrationEnabled: boolean;
}

export function useAuthPage(args: UseAuthPageArgs) {
  const { apiBase, initialView, initialInvite, initialGuestToken, registrationEnabled } = args;
  const s = useAuthPageState(initialView, initialInvite);

  const handlers = useAuthHandlers({
    apiBase,
    setError: s.setError,
    setMessage: s.setMessage,
    setMessageType: s.setMessageType,
    setView: s.setView,
  });

  useRedirectWhenRegistrationDisabled({
    registrationEnabled,
    view: s.view,
    invite: s.invite,
    initialInvite,
    setView: s.setView,
  });

  useDebugAutoLogin({
    post: handlers.postRaw,
    storeDesktopAuthToken: handlers.storeDesktopAuthToken,
    setError: s.setError,
  });

  useGuestAutoLogin({
    initialGuestToken,
    view: s.view,
    post: handlers.postRaw,
    storeDesktopAuthToken: handlers.storeDesktopAuthToken,
    setError: s.setError,
    setGuestLoading: s.setGuestLoading,
  });

  const handleCreateTenant = useTenantCreation({
    apiBase,
    regData: s.regData,
    setError: s.setError,
    setSlugError: s.setSlugError,
    setSubmitLoading: s.setSubmitLoading,
    setRegStep: s.setRegStep,
    setRegData: s.setRegData,
    storeDesktopAuthToken: handlers.storeDesktopAuthToken,
  });

  const handleInvite = useCallback(
    (code: string): Promise<void> => {
      s.setError(null);
      s.setInvite(code);
      s.setView('register');
      return Promise.resolve();
    },
    [s],
  );

  const switchView = useCallback(
    (next: AuthViewName) => {
      s.setError(null);
      s.setMessage(null);
      s.setView(next);
    },
    [s],
  );

  return { state: s, handlers, handleCreateTenant, handleInvite, switchView };
}
