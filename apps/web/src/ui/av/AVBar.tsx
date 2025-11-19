import React from 'react';
import { ButtonGroup } from '../buttonGroup/ButtonGroup';
import { Button, Separator } from '../buttonGroup';
import type { ButtonGroupItemSize } from '../buttonGroup';
import { FAIcon } from '../FAIcon';
import { AudioSettingsModal } from './AudioSettingsModal';
import { useTranslation } from 'react-i18next';
import { PopoverRoot, PopoverTrigger, PopoverContent, PopoverArrow } from '../primitives/Popover';

function DeviceSelector(props: {
  icon: string;
  isOn: boolean;
  onToggle: () => void;
  devices: { id: string; label: string }[];
  selectedId: string | '';
  onSelect: (id: string) => void;
  labelSelect: string;
  disabled?: boolean;
}) {
  const { icon, isOn, onToggle, devices, selectedId, onSelect, labelSelect, disabled } = props;
  const [open, setOpen] = React.useState(false);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Button
        disabled={disabled}
        variant={isOn ? 'primary' : 'default'}
        onClick={onToggle}
        icon={icon}
        iconPosition="only"
        style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
      />
      <PopoverRoot open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            disabled={disabled}
            variant={isOn ? 'primary' : 'default'}
            icon="caret-up"
            iconPosition="only"
            style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, paddingLeft: 4, paddingRight: 4, minWidth: 24 }}
          />
        </PopoverTrigger>
        <PopoverContent side="top" align="center" sideOffset={5} style={{ zIndex: 1000 }}>
          <div className="glass-surface" style={{ padding: 4, display: 'grid', gap: 2, minWidth: 200 }}>
            <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--fg-subtle)', fontWeight: 600 }}>
              {labelSelect}
            </div>
            {devices.length === 0 && (
              <div style={{ padding: '8px', fontSize: 13, color: 'var(--fg-subtle)', fontStyle: 'italic' }}>
                Keine Geräte gefunden
              </div>
            )}
            {devices.map(d => (
              <button
                key={d.id}
                onClick={() => { onSelect(d.id); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: d.id === selectedId ? 'rgba(255,255,255,0.1)' : 'transparent',
                  border: 'none', borderRadius: 4,
                  padding: '6px 8px',
                  color: 'var(--fg)',
                  fontSize: 13,
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                {d.id === selectedId && <FAIcon name="check" size="xs" />}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
              </button>
            ))}
          </div>
          <PopoverArrow style={{ fill: 'var(--glass)' }} />
        </PopoverContent>
      </PopoverRoot>
    </div>
  );
}

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
      <DeviceSelector
        icon={micOn ? 'microphone' : 'microphone-slash'}
        isOn={micOn}
        onToggle={onToggleMic}
        devices={devices.mics}
        selectedId={selectedMicId}
        onSelect={onSelectMic}
        labelSelect={t('av.selectMic')}
        disabled={dndOn}
      />

      <Separator variant="vertical" />

      <DeviceSelector
        icon={camOn ? 'video' : 'video-slash'}
        isOn={camOn}
        onToggle={onToggleCam}
        devices={devices.cams}
        selectedId={selectedCamId}
        onSelect={onSelectCam}
        labelSelect={t('av.selectCam')}
        disabled={dndOn}
      />

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


