import React from 'react';
import { AuthScreen } from '../../../ui/auth/AuthScreen';
import { Signup } from '../../../ui/auth/Signup';

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
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start', padding: '6vh 6vw' }}>
        <div>
          <h2 style={{ margin: '8px 0' }}>Anmelden</h2>
          <AuthScreen baseUrl={apiBase} onDone={onAuthComplete} />
        </div>
        <div>
          <h2 style={{ margin: '8px 0' }}>Registrieren (neuen Mandanten anlegen)</h2>
          <Signup apiBase={apiBase} onSuccess={(slug) => {
            try {
              const proto = window.location.protocol;
              const host = window.location.host;
              const baseHost = host.split(':')[0];
              const parts = baseHost.split('.');
              if (parts.length >= 2) {
                const rest = parts.slice(-2).join('.');
                const port = host.includes(':') ? (':' + host.split(':')[1]) : '';
                window.location.href = `${proto}//${slug}.${rest}${port}`;
              } else {
                // localhost/dev fallback: reload to keep cookie
                window.location.reload();
              }
            } catch { window.location.reload(); }
          }} />
        </div>
      </div>
    );
  }

  if (!positionReady) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>Position wird geladen…</div>
    );
  }

  return null;
}
