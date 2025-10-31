import React from 'react';
import { ButtonGroup } from '../buttonGroup/ButtonGroup';
import { Button, Separator } from '../buttonGroup';
import type { ButtonGroupItemSize } from '../buttonGroup';
import { FAIcon } from '../FAIcon';
import { AudioSettingsModal } from './AudioSettingsModal';
import { useTranslation } from 'react-i18next';

export function AVBar(props: {
  size?: ButtonGroupItemSize;
  micOn: boolean;
  camOn: boolean;
  shareOn: boolean;
  dndOn: boolean;
  devices: { mics: { id: string; label: string }[]; cams: { id: string; label: string }[] };
  selectedMicId: string | '';
  selectedCamId: string | '';
  onToggleMic: () => void | Promise<void>;
  onSelectMic: (id: string) => void | Promise<void>;
  onToggleCam: () => void | Promise<void>;
  onSelectCam: (id: string) => void | Promise<void>;
  onToggleShare: () => void | Promise<void>;
  onToggleDnd: () => void | Promise<void>;
  cameraManual?: boolean;
  onRecenter?: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const {
    size = 'md', micOn, camOn, shareOn, dndOn,
    devices, selectedMicId, selectedCamId,
    onToggleMic, onSelectMic, onToggleCam, onSelectCam,
    onToggleShare, onToggleDnd, cameraManual, onRecenter,
    className, style
  } = props;

  const [settingsOpen, setSettingsOpen] = React.useState(false);
  // Default: Einstellungen sichtbar, außer explizit deaktiviert
  const showSettings = ((import.meta as any).env?.VITE_FEATURE_AV_SETTINGS !== 'false');
  const { t } = useTranslation();

  return (
    <ButtonGroup size={size} {...(className ? { className } : {})} {...(style ? { style } : {})}>
      <Button
        disabled={dndOn}
        variant={micOn ? 'primary' : 'default'}
        onClick={onToggleMic}
        icon={micOn ? 'microphone' : 'microphone-slash'}
        iconPosition="only"
      />
      <select
        className="bg-select"
        disabled={!devices.mics.length || dndOn}
        value={selectedMicId}
        onChange={(e) => onSelectMic(e.target.value)}
        style={{
          height: 'var(--bg-item-height, 32px)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)',
          background: 'var(--glass)',
          padding: '0 10px',
          color: 'var(--fg)'
        }}
      >
        <option value="" disabled>{t('av.selectMic')}</option>
        {devices.mics.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>

      <Separator variant="vertical" />

      <Button
        disabled={dndOn}
        variant={camOn ? 'primary' : 'default'}
        onClick={onToggleCam}
        icon={camOn ? 'video' : 'video-slash'}
        iconPosition="only"
      />
      <select
        className="bg-select"
        disabled={!devices.cams.length || dndOn}
        value={selectedCamId}
        onChange={(e) => onSelectCam(e.target.value)}
        style={{
          height: 'var(--bg-item-height, 32px)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)',
          background: 'var(--glass)',
          padding: '0 10px',
          color: 'var(--fg)'
        }}
      >
        <option value="" disabled>{t('av.selectCam')}</option>
        {devices.cams.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>

      <Separator variant="vertical" />

      <Button
        disabled={dndOn}
        variant={shareOn ? 'primary' : 'default'}
        onClick={onToggleShare}
        iconPosition="left"
      >
        <FAIcon name="screencast" variant="solid" />
        <span>{shareOn ? t('av.share.stop') : t('av.share.start')}</span>
      </Button>

      <Separator variant="vertical" />

      <Button active={dndOn} onClick={onToggleDnd} icon="bell-slash" iconPosition="only" title={dndOn ? t('av.dnd.on') : t('av.dnd.off')} />
      {cameraManual && (
        <Button disabled={dndOn} onClick={onRecenter} icon="location-crosshairs" iconPosition="only" title={t('av.recenter')} />
      )}
      {showSettings && (
        <>
          <Separator variant="vertical" />
          <Button onClick={() => setSettingsOpen(true)} icon="gear" iconPosition="only" title={t('av.audioSettings')} />
          <AudioSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
        </>
      )}
    </ButtonGroup>
  );
}


