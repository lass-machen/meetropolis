import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { AvatarSettings } from '../settings/AvatarSettings';
import { gameBridge } from '../../game/bridge';
import { logger } from '../../lib/logger';
import { avatarRegistry, type AvatarManifest } from '../../game/avatarRegistry';
import { usePublicConfigStore } from '../../state/publicConfigStore';

const AvatarEditor = React.lazy(() => import('../settings/avatar-editor/AvatarEditor'));

interface OnboardingWizardProps {
  me: { id: string; email: string; name?: string; onboardingCompleted?: boolean };
  apiBase: string;
  onComplete: (updatedMe: { onboardingCompleted: boolean; avatarId?: string }) => void;
}

export function OnboardingWizard({ me, apiBase, onComplete }: OnboardingWizardProps) {
  const { t } = useTranslation('common');
  const [selectedAvatarId, setSelectedAvatarId] = React.useState(
    () => localStorage.getItem('avatarId') || 'default-characters:business_man',
  );
  const [submitting, setSubmitting] = React.useState(false);
  const avatarEditorEnabled = usePublicConfigStore((s) => s.avatarEditorEnabled);
  const loadPublicConfig = usePublicConfigStore((s) => s.load);
  const [avatarMode, setAvatarMode] = React.useState<'template' | 'custom'>('template');

  React.useEffect(() => {
    void loadPublicConfig(apiBase);
  }, [loadPublicConfig, apiBase]);

  // The editor already composed + set User.avatarId server-side; register the
  // manifest so the avatar renders now, and remember the id for onboarding.
  const handleCustomSaved = (avatarId: string, manifest: AvatarManifest) => {
    avatarRegistry.registerManifest(manifest);
    setSelectedAvatarId(avatarId);
    try {
      gameBridge.changeHeroAvatar(avatarId);
    } catch (e) {
      logger.debug('[OnboardingWizard] avatar bridge error', e);
    }
  };

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
  // The editor lays its tiles out with `repeat(auto-fill, 104px)`, so the column
  // count is a pure function of the width it is handed. At the wizard's default
  // 480px it collapses to two columns and turns into a long scroll; the profile
  // dialog gives it 980px and gets ~6. First contact should not be the worst
  // variant, so the modal widens for the editor and only for the editor — the
  // template picker keeps its narrow, focused column.
  const editorActive = avatarEditorEnabled && avatarMode === 'custom';

  return (
    <>
      <style>{keyframes}</style>
      <div style={styles.backdrop}>
        <div
          className="onb-modal"
          style={{ ...styles.modal, maxWidth: editorActive ? EDITOR_MODAL_WIDTH : DEFAULT_MODAL_WIDTH }}
        >
          <div style={styles.glowTop} />

          <h1 style={styles.heading}>
            <Trans
              i18nKey="onboarding.welcome"
              values={{ name: displayName }}
              components={{ 1: <span style={styles.nameHighlight} /> }}
            />
          </h1>
          <p style={styles.subtitle}>{t('onboarding.subtitle')}</p>

          <div style={styles.avatarArea}>
            {avatarEditorEnabled && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={() => setAvatarMode('template')}
                  style={toggleStyle(avatarMode === 'template')}
                >
                  Vorlage
                </button>
                <button
                  type="button"
                  onClick={() => setAvatarMode('custom')}
                  style={toggleStyle(avatarMode === 'custom')}
                >
                  Eigenen erstellen
                </button>
              </div>
            )}
            {avatarEditorEnabled && avatarMode === 'custom' ? (
              <React.Suspense
                fallback={<div style={{ padding: 16, color: 'rgba(255,255,255,0.5)' }}>Lade Editor…</div>}
              >
                <AvatarEditor onSaved={handleCustomSaved} />
              </React.Suspense>
            ) : (
              <AvatarSettings currentAvatarId={selectedAvatarId} onAvatarChange={(id) => setSelectedAvatarId(id)} />
            )}
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
            {submitting ? t('onboarding.submitting') : t('onboarding.cta')}
          </button>
        </div>
      </div>
    </>
  );
}

// Active fill follows the .sys-btn--primary brand gradient rather than a flat
// --brand-accent: the orange alone carries too little contrast under white text.
function toggleStyle(active: boolean): React.CSSProperties {
  return {
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 999,
    cursor: 'pointer',
    color: '#fff',
    border: '1px solid transparent',
    background: active
      ? 'linear-gradient(135deg, var(--brand-primary, #450db3), var(--brand-accent, #f3a814))'
      : 'rgba(255,255,255,0.08)',
  };
}

/** Width of the wizard for the template picker — a single focused column. */
const DEFAULT_MODAL_WIDTH = 480;
/** Width the avatar editor needs to lay its tile grid out, matching the profile dialog. */
const EDITOR_MODAL_WIDTH = 980;

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
/* The dialog's entrance, glow and width change are inline styles, so the
   reduced-motion opt-out has to outrank them. */
@media (prefers-reduced-motion: reduce) {
  .onb-modal,
  .onb-modal * {
    animation: none !important;
    transition: none !important;
  }
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
    // maxWidth is set by the caller: the editor needs more room than the
    // template picker. Kept out of here so there is one source for the value.
    maxHeight: '85vh',
    // Softens the resize when switching between template and editor rather than
    // snapping the dialog open. Suppressed under reduced motion below.
    transition: 'max-width 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
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
