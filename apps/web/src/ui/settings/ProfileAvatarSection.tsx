import React from 'react';
import { useTranslation } from 'react-i18next';
import { getApiBaseFromWindow } from '../../lib/apiBase';
import { gameBridge } from '../../game/bridge';
import { avatarRegistry, type AvatarManifest } from '../../game/avatarRegistry';
import { usePublicConfigStore } from '../../state/publicConfigStore';
import type { WorldRoom } from '../../types/colyseus';
import { AvatarSettings } from './AvatarSettings';
import { Button, Section } from '../system';

// The character editor (catalog + shared composer) is code-split so its ~186 KB
// catalog asset loads only when the user opens the "create your own" tab.
const AvatarEditor = React.lazy(() => import('./avatar-editor/AvatarEditor'));

interface Props {
  avatarId: string;
  setAvatarId: (id: string) => void;
  colyseusRef?: React.RefObject<WorldRoom | null> | undefined;
  setSuccess: (msg: string) => void;
  setError: (msg: string) => void;
  /** Reports that the character editor needs a wider modal than the forms do. */
  onWideLayoutChange?: ((wide: boolean) => void) | undefined;
}

/** Shared hero-update chain: local hero, persisted id, and the peer broadcast. */
function applyHeroAvatar(colyseusRef: Props['colyseusRef'], setAvatarId: Props['setAvatarId'], avatarId: string): void {
  setAvatarId(avatarId);
  localStorage.setItem('avatarId', avatarId);
  gameBridge.changeHeroAvatar(avatarId);
  try {
    colyseusRef?.current?.send('avatar_change', { avatarId });
  } catch {}
}

/**
 * The avatar Section of the profile settings: pick a template, or — when the
 * editor flag is on — build a custom avatar. Extracted from ProfileSettings to
 * keep that component within its size budget.
 */
export function ProfileAvatarSection({
  avatarId,
  setAvatarId,
  colyseusRef,
  setSuccess,
  setError,
  onWideLayoutChange,
}: Props) {
  const { t } = useTranslation();
  const apiBase = getApiBaseFromWindow();
  const avatarEditorEnabled = usePublicConfigStore((s) => s.avatarEditorEnabled);
  const loadPublicConfig = usePublicConfigStore((s) => s.load);
  const [mode, setMode] = React.useState<'template' | 'custom'>('template');
  const editorOpen = avatarEditorEnabled && mode === 'custom';

  React.useEffect(() => {
    void loadPublicConfig(apiBase);
  }, [loadPublicConfig, apiBase]);

  React.useEffect(() => {
    onWideLayoutChange?.(editorOpen);
  }, [editorOpen, onWideLayoutChange]);

  // Template picker: persist via PATCH /me/avatar, then update the hero.
  const handleTemplateChange = async (newAvatarId: string) => {
    try {
      const res = await fetch(`${apiBase}/me/avatar`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarId: newAvatarId }),
      });
      if (!res.ok) {
        setError(t('profile.avatarFailed'));
        return;
      }
      applyHeroAvatar(colyseusRef, setAvatarId, newAvatarId);
      setSuccess(t('profile.avatarUpdated'));
    } catch {
      setError(t('profile.avatarFailed'));
    }
  };

  // Custom editor: the server already composited + set User.avatarId, so we skip
  // the PATCH and register the returned manifest so the avatar renders at once.
  const handleCustomSaved = (newAvatarId: string, manifest: AvatarManifest) => {
    avatarRegistry.registerManifest(manifest);
    applyHeroAvatar(colyseusRef, setAvatarId, newAvatarId);
    setSuccess(t('profile.avatarUpdated'));
  };

  return (
    <Section title={t('profile.avatar')}>
      {avatarEditorEnabled && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Button variant={mode === 'template' ? 'primary' : 'ghost'} onClick={() => setMode('template')}>
            Vorlage
          </Button>
          <Button variant={mode === 'custom' ? 'primary' : 'ghost'} onClick={() => setMode('custom')}>
            Eigenen erstellen
          </Button>
        </div>
      )}
      {editorOpen ? (
        <React.Suspense fallback={<div style={{ padding: 16, color: 'var(--fg-subtle, #888)' }}>Lade Editor…</div>}>
          <AvatarEditor onSaved={handleCustomSaved} />
        </React.Suspense>
      ) : (
        <AvatarSettings
          currentAvatarId={avatarId}
          onAvatarChange={(id) => {
            void handleTemplateChange(id);
          }}
        />
      )}
    </Section>
  );
}

export default ProfileAvatarSection;
