import { useTranslation } from 'react-i18next';

interface AuthLoadingScreenProps {
  authChecked: boolean;
  me: { id: string; email: string; name?: string } | null;
  positionReady: boolean;
  apiBase: string;
  // Callers may pass a sync or async handler, matching the React convention.
  // The component itself does not invoke this currently (the loading screen
  // only renders), but the prop is kept for API stability.
  onAuthComplete: () => void | Promise<void>;
}

export function AuthLoadingScreen({ authChecked, me, positionReady }: AuthLoadingScreenProps) {
  const { t } = useTranslation();

  if (!authChecked) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>{t('auth.loading')}</div>;
  }

  if (!me) {
    // Redirect to standalone login page instead of rendering inline AuthScreen
    window.location.hash = '#/login';
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>{t('auth.redirecting')}</div>;
  }

  if (!positionReady) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>{t('auth.positionLoading')}</div>;
  }

  return null;
}
