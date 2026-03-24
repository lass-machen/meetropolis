import { AuthScreen } from '../../../ui/auth/AuthScreen';

interface AuthLoadingScreenProps {
  authChecked: boolean;
  me: { id: string; email: string; name?: string } | null;
  positionReady: boolean;
  apiBase: string;
  onAuthComplete: () => Promise<void>;
}

export function AuthLoadingScreen({
  authChecked,
  me,
  positionReady,
  apiBase,
  onAuthComplete,
}: AuthLoadingScreenProps) {
  if (!authChecked) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>Lade…</div>
    );
  }

  if (!me) {
    return <AuthScreen baseUrl={apiBase} onDone={onAuthComplete} />;
  }

  if (!positionReady) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>Position wird geladen…</div>
    );
  }

  return null;
}
