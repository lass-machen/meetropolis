import { LoginView } from './LoginView';
import { RegisterView } from './RegisterView';
import { RegisterStep2View } from './RegisterStep2View';
import { RegisterStep3View } from './RegisterStep3View';
import { InviteCodeView } from './InviteCodeView';
import { ForgotPasswordView } from './ForgotPasswordView';
import { ResetPasswordView } from './ResetPasswordView';
import { GuestView } from './GuestView';
import type { AuthViewName } from './hooks/useAuthHandlers';

export interface RegistrationData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  teamName: string;
  teamSize: string;
  slug: string;
  plan: string;
}

export interface AuthRenderArgs {
  view: AuthViewName;
  invite: string;
  initialInvite: string | undefined;
  initialResetToken: string | undefined;
  initialResetEmail: string | undefined;
  registrationEnabled: boolean;
  error: string | null;
  message: string | null;
  messageType: 'error' | 'success';
  guestLoading: boolean;
  regStep: number;
  regData: RegistrationData;
  slugError: string | null;
  submitLoading: boolean;
  switchView: (next: AuthViewName) => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (data: { name: string; email: string; password: string; invite?: string | undefined }) => Promise<void>;
  onForgot: (email: string) => Promise<void>;
  onReset: (email: string, token: string, password: string) => Promise<void>;
  onInvite: (code: string) => Promise<void>;
  onCreateTenant: (plan: string) => Promise<void>;
  setRegStep: (step: number) => void;
  setRegData: (updater: (prev: RegistrationData) => RegistrationData) => void;
  setSlugError: (msg: string | null) => void;
}

function renderLogin(args: AuthRenderArgs) {
  const { onLogin, switchView, error, message, messageType, registrationEnabled } = args;
  return (
    <LoginView
      onSubmit={onLogin}
      onForgot={() => switchView('forgot')}
      onRegister={() => switchView('register')}
      onInvite={() => switchView('invite')}
      error={error}
      successMessage={messageType === 'success' ? message : null}
      registrationEnabled={registrationEnabled}
    />
  );
}

function renderRegisterFlow(args: AuthRenderArgs) {
  const {
    invite,
    onRegister,
    switchView,
    error,
    regStep,
    regData,
    setRegData,
    setRegStep,
    setSlugError,
    slugError,
    submitLoading,
    onCreateTenant,
  } = args;

  if (invite) {
    return (
      <RegisterView
        onSubmit={onRegister}
        onLogin={() => switchView('login')}
        initialInvite={invite}
        error={error}
      />
    );
  }
  if (regStep === 1) {
    return (
      <RegisterView
        onSubmit={async (data) => {
          const nameParts = data.name.split(' ');
          setRegData((prev) => ({
            ...prev,
            firstName: nameParts[0] || '',
            lastName: nameParts.slice(1).join(' ') || '',
            email: data.email,
            password: data.password,
          }));
          setRegStep(2);
        }}
        onLogin={() => switchView('login')}
        error={error}
      />
    );
  }
  if (regStep === 2) {
    return (
      <RegisterStep2View
        onNext={(data) => {
          setRegData((prev) => ({ ...prev, ...data }));
          setSlugError(null);
          setRegStep(3);
        }}
        onBack={() => setRegStep(1)}
        initialData={{
          teamName: regData.teamName,
          teamSize: regData.teamSize,
          slug: regData.slug,
        }}
        slugError={slugError}
      />
    );
  }
  if (regStep === 3) {
    return (
      <RegisterStep3View
        onSubmit={onCreateTenant}
        onBack={() => setRegStep(2)}
        initialPlan={regData.plan}
        error={error}
        loading={submitLoading}
      />
    );
  }
  return null;
}

function renderInvite(args: AuthRenderArgs) {
  const { onInvite, switchView, initialInvite, error, registrationEnabled } = args;
  return (
    <InviteCodeView
      onSubmit={onInvite}
      onLogin={() => switchView('login')}
      onRegister={() => switchView('register')}
      initialCode={initialInvite}
      error={error}
      registrationEnabled={registrationEnabled}
    />
  );
}

function renderForgot(args: AuthRenderArgs) {
  const { onForgot, switchView, message, messageType } = args;
  return (
    <ForgotPasswordView
      onSubmit={onForgot}
      onBack={() => switchView('login')}
      message={message}
      messageType={messageType}
    />
  );
}

function renderReset(args: AuthRenderArgs) {
  const { onReset, switchView, initialResetEmail, initialResetToken, message, messageType } = args;
  return (
    <ResetPasswordView
      onSubmit={onReset}
      onBack={() => switchView('login')}
      initialEmail={initialResetEmail}
      initialToken={initialResetToken}
      message={message}
      messageType={messageType}
    />
  );
}

function renderGuest(args: AuthRenderArgs) {
  const { guestLoading, error, switchView } = args;
  return (
    <GuestView
      loading={guestLoading}
      error={error}
      onBack={() => switchView('login')}
    />
  );
}

export function renderAuthView(args: AuthRenderArgs) {
  switch (args.view) {
    case 'login':
      return renderLogin(args);
    case 'register':
      return renderRegisterFlow(args);
    case 'invite':
      return renderInvite(args);
    case 'forgot':
      return renderForgot(args);
    case 'reset':
      return renderReset(args);
    case 'guest':
      return renderGuest(args);
    default:
      return null;
  }
}
