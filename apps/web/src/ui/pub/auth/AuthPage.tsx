import { AuthLayout } from '../layout/AuthLayout';
import type { AuthViewName } from './hooks/useAuthHandlers';
import { useAuthPage } from './hooks/useAuthPage';
import { renderAuthView } from './AuthPageRenderer';

interface AuthPageProps {
  apiBase: string;
  initialView?: AuthViewName;
  initialInvite?: string | undefined;
  initialResetToken?: string | undefined;
  initialResetEmail?: string | undefined;
  initialGuestToken?: string | undefined;
  initialPlan?: string | undefined;
  registrationEnabled?: boolean;
}

export function AuthPage({
  apiBase,
  initialView = 'login',
  initialInvite,
  initialResetToken,
  initialResetEmail,
  initialGuestToken,
  initialPlan,
  registrationEnabled = true,
}: AuthPageProps) {
  const {
    state: s,
    handlers,
    handleCreateTenant,
    handleInvite,
    switchView,
  } = useAuthPage({
    apiBase,
    initialView,
    initialInvite,
    initialGuestToken,
    initialPlan,
    registrationEnabled,
  });

  return (
    <AuthLayout>
      {renderAuthView({
        apiBase,
        view: s.view,
        invite: s.invite,
        initialInvite,
        initialResetToken,
        initialResetEmail,
        registrationEnabled,
        error: s.error,
        message: s.message,
        messageType: s.messageType,
        guestLoading: s.guestLoading,
        regStep: s.regStep,
        regData: s.regData,
        slugError: s.slugError,
        submitLoading: s.submitLoading,
        switchView,
        onLogin: handlers.handleLogin,
        onRegister: (data) => handlers.handleRegister(data, s.invite),
        onForgot: handlers.handleForgot,
        onReset: handlers.handleReset,
        onInvite: handleInvite,
        onCreateTenant: handleCreateTenant,
        setRegStep: s.setRegStep,
        setRegData: s.setRegData,
        setSlugError: s.setSlugError,
      })}
    </AuthLayout>
  );
}
