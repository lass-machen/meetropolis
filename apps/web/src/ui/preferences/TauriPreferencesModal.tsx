import * as React from 'react';
import { Modal, FieldRow, Checkbox } from '../system';
import { useTranslation } from 'react-i18next';
import { logger } from '../../lib/logger';

// Check if we're in a Tauri environment
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;

export function TauriPreferencesModal(props: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { open, onOpenChange } = props;
  const { t } = useTranslation();
  const [audioDucking, setAudioDucking] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  // Read initial value when modal opens
  React.useEffect(() => {
    if (!open || !isTauri) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const enabled = await invoke<boolean>('get_audio_ducking');
        if (!cancelled) {
          setAudioDucking(enabled);
          setLoading(false);
        }
      } catch (e) {
        logger.warn('[TauriPrefs] Failed to get audio ducking state:', e);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  if (!isTauri) return null;

  const handleToggle = async (checked: boolean) => {
    setAudioDucking(checked);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_audio_ducking', { enabled: checked });
    } catch (e) {
      logger.error('[TauriPrefs] Failed to set audio ducking:', e);
      setAudioDucking(!checked);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t('tauri.prefs.title')} description={t('tauri.prefs.desc')} maxWidth={480}>
      <div style={{ display: 'grid', gap: 14 }}>
        <FieldRow
          label={t('tauri.prefs.audioDucking')}
          hint={t('tauri.prefs.audioDuckingHint')}
          control={
            <Checkbox
              checked={audioDucking}
              disabled={loading}
              onChange={e => handleToggle((e.target as HTMLInputElement).checked)}
            />
          }
        />
      </div>
    </Modal>
  );
}
