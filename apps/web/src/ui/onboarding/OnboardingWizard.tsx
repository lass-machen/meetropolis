import React from 'react';
import { AvatarSettings } from '../settings/AvatarSettings';
import { gameBridge } from '../../game/bridge';
import { logger } from '../../lib/logger';

interface OnboardingWizardProps {
  me: { id: string; email: string; name?: string; onboardingCompleted?: boolean };
  apiBase: string;
  onComplete: (updatedMe: { onboardingCompleted: boolean; avatarId?: string }) => void;
}

export function OnboardingWizard({ me, apiBase, onComplete }: OnboardingWizardProps) {
  const [selectedAvatarId, setSelectedAvatarId] = React.useState(
    () => localStorage.getItem('avatarId') || 'default-characters:businessman1',
  );
  const [submitting, setSubmitting] = React.useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/auth/onboarding/complete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarId: selectedAvatarId }),
      });
      if (res.ok) {
        localStorage.setItem('avatarId', selectedAvatarId);
        try {
          gameBridge.changeHeroAvatar(selectedAvatarId);
        } catch (e) {
          logger.debug('[OnboardingWizard] avatar bridge error', e);
        }
        onComplete({ onboardingCompleted: true, avatarId: selectedAvatarId });
      } else {
        logger.warn('[OnboardingWizard] Server responded with', res.status);
        onComplete({ onboardingCompleted: true, avatarId: selectedAvatarId });
      }
    } catch (err) {
      logger.warn('[OnboardingWizard] Network error', err);
      onComplete({ onboardingCompleted: true, avatarId: selectedAvatarId });
    } finally {
      setSubmitting(false);
    }
  };

  const displayName = me.name || me.email.split('@')[0];

  return (
    <>
      <style>{keyframes}</style>
      <div style={styles.backdrop}>
        <div style={styles.modal}>
          <div style={styles.glowTop} />

          <h1 style={styles.heading}>
            Willkommen, <span style={styles.nameHighlight}>{displayName}</span>!
          </h1>
          <p style={styles.subtitle}>Wähle deinen Avatar</p>

          <div style={styles.avatarArea}>
            <AvatarSettings currentAvatarId={selectedAvatarId} onAvatarChange={(id) => setSelectedAvatarId(id)} />
          </div>

          <button
            onClick={() => {
              void handleConfirm();
            }}
            disabled={submitting}
            style={{
              ...styles.button,
              ...(submitting ? styles.buttonDisabled : {}),
            }}
          >
            {submitting ? 'Einen Moment...' : 'Loslegen'}
          </button>
        </div>
      </div>
    </>
  );
}

const keyframes = `
@keyframes onb-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes onb-slide-up {
  from { opacity: 0; transform: translateY(24px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes onb-glow-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.8; }
}
`;

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 9000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.65)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    animation: 'onb-fade-in 0.4s ease-out both',
  },
  modal: {
    position: 'relative',
    width: '90vw',
    maxWidth: 480,
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    padding: '36px 32px 28px',
    background: 'rgba(22, 22, 30, 0.92)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 20,
    boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
    overflow: 'hidden',
    animation: 'onb-slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both',
  },
  glowTop: {
    position: 'absolute',
    top: -60,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 240,
    height: 120,
    borderRadius: '50%',
    background: 'var(--accent, #3b82f6)',
    filter: 'blur(60px)',
    opacity: 0.3,
    pointerEvents: 'none',
    animation: 'onb-glow-pulse 4s ease-in-out infinite',
  },
  heading: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    color: '#f0f0f4',
    textAlign: 'center',
    letterSpacing: '-0.01em',
    lineHeight: 1.3,
  },
  nameHighlight: {
    color: 'var(--accent, #3b82f6)',
  },
  subtitle: {
    margin: '8px 0 0',
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    fontWeight: 400,
  },
  avatarArea: {
    flex: 1,
    marginTop: 24,
    overflowY: 'auto',
    minHeight: 0,
    paddingRight: 4,
  },
  button: {
    display: 'block',
    width: '100%',
    marginTop: 24,
    padding: '14px 0',
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
    background: 'var(--accent, #3b82f6)',
    border: 'none',
    borderRadius: 12,
    cursor: 'pointer',
    letterSpacing: '0.01em',
    transition: 'filter 0.15s, transform 0.15s',
    boxShadow: '0 4px 16px rgba(59,130,246,0.25)',
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
    filter: 'grayscale(0.3)',
  },
};

export default OnboardingWizard;
