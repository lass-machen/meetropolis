import { Modal, Select, Checkbox, Slider, FieldRow } from '../system';
import { useAvSettingsStore } from '../../state/avSettings';
import { useCameraSettingsStore } from '../../state/cameraSettings';
import { useTranslation } from 'react-i18next';

export function AudioSettingsModal(props: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { open, onOpenChange } = props;
  const settings = useAvSettingsStore((s) => s.settings);
  const setSetting = useAvSettingsStore((s) => s.setSetting);
  const applyPreset = useAvSettingsStore((s) => s.applyPreset);
  const cameraSettings = useCameraSettingsStore((s) => s.settings);
  const setCameraSetting = useCameraSettingsStore((s) => s.setSetting);
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('settings.title')}
      description={t('settings.desc')}
      maxWidth={560}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        {/* Camera section */}
        <FieldRow
          label={t('settings.centerCamera')}
          control={
            <Checkbox
              checked={cameraSettings.centerCamera}
              onChange={(e) => setCameraSetting('centerCamera', e.target.checked)}
            />
          }
        />
        <div style={{ height: 1, background: 'var(--border)' }} />
        <FieldRow
          label={t('av.noiseSuppression')}
          control={
            <Checkbox
              checked={settings.noiseSuppression}
              onChange={(e) => setSetting('noiseSuppression', e.target.checked)}
            />
          }
        />
        <FieldRow
          label={t('av.echoCancellation')}
          control={
            <Checkbox
              checked={settings.echoCancellation}
              onChange={(e) => setSetting('echoCancellation', e.target.checked)}
            />
          }
        />
        <FieldRow
          label={t('av.autoGainControl')}
          control={
            <Checkbox
              checked={settings.autoGainControl}
              onChange={(e) => setSetting('autoGainControl', e.target.checked)}
            />
          }
        />

        <div style={{ height: 1, background: 'var(--border)' }} />

        <FieldRow
          label={t('av.hpFilter')}
          control={
            <Checkbox
              checked={settings.highpassFilter}
              onChange={(e) => setSetting('highpassFilter', e.target.checked)}
            />
          }
        />
        <FieldRow
          label={t('av.lightCompressor')}
          control={
            <Checkbox checked={settings.compressor} onChange={(e) => setSetting('compressor', e.target.checked)} />
          }
        />

        <div style={{ height: 1, background: 'var(--border)' }} />

        <FieldRow
          label={t('av.bitrate')}
          control={
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Slider
                min={16}
                max={56}
                step={2}
                value={settings.opusBitrateKbps}
                onChange={(e) => setSetting('opusBitrateKbps', Number(e.target.value))}
              />
              <span style={{ minWidth: 36, textAlign: 'right' }}>{settings.opusBitrateKbps}</span>
            </div>
          }
        />
        <FieldRow
          label={t('av.dtx')}
          control={<Checkbox checked={settings.useDtx} onChange={(e) => setSetting('useDtx', e.target.checked)} />}
        />
        <FieldRow
          label={t('av.fec')}
          control={<Checkbox checked={settings.useFec} onChange={(e) => setSetting('useFec', e.target.checked)} />}
        />

        <div style={{ height: 1, background: 'var(--border)' }} />

        <FieldRow
          label={t('av.preset')}
          control={
            <Select
              value={settings.preset}
              onChange={(val) => applyPreset(val as any)}
              options={[
                { value: 'standard', label: t('av.preset.standard') },
                { value: 'quiet', label: t('av.preset.quiet') },
                { value: 'loud', label: t('av.preset.loud') },
                { value: 'studio', label: t('av.preset.studio') },
              ]}
            />
          }
        />
      </div>
    </Modal>
  );
}
