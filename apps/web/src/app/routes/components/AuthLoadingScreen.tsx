import { useTranslation } from 'react-i18next';

interface AuthLoadingScreenProps {
  authChecked: boolean;
  me: { id: string; email: string; name?: string } | null;
  positionReady: boolean;
  // True while the boot auth-check is stuck on a transient network/5xx error.
  offline?: boolean;
  apiBase: string;
  // Callers may pass a sync or async handler, matching the React convention.
  // The component itself does not invoke this currently (the loading screen
  // only renders), but the prop is kept for API stability.
  onAuthComplete: () => void | Promise<void>;
}

export function AuthLoadingScreen({ authChecked, me, positionReady, offline = false }: AuthLoadingScreenProps) {
  const { t } = useTranslation();

  // A transient outage during boot must not look like a logout: hold on a quiet
  // offline hint and keep waiting for the retry loop rather than redirecting.
  if (offline && !me) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>{t('auth.offline')}</div>;
  }

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
