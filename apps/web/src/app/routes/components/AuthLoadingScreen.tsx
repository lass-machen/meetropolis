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
  if (!authChecked) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>Lade…</div>;
  }

  if (!me) {
    // Redirect to standalone login page instead of rendering inline AuthScreen
    window.location.hash = '#/login';
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>Weiterleitung…</div>;
  }

  if (!positionReady) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>Position wird geladen…</div>;
  }

  return null;
}
