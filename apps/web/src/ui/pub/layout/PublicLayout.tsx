import React from 'react';
import { PublicHeader } from './PublicHeader';
import { PublicFooter } from './PublicFooter';

interface PublicLayoutProps {
  children: React.ReactNode;
  onLogin: () => void;
  onSignup: () => void;
  navigate: (route: string) => void;
  registrationEnabled?: boolean;
}

export function PublicLayout({
  children,
  onLogin,
  onSignup,
  navigate,
  registrationEnabled = true,
}: PublicLayoutProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--pub-bg-primary)',
      }}
    >
      <PublicHeader onLogin={onLogin} onSignup={onSignup} registrationEnabled={registrationEnabled} />
      <main>{children}</main>
      <PublicFooter navigate={navigate} />
    </div>
  );
}
