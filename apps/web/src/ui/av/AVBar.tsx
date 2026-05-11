import React, { useEffect, useRef } from 'react';
import { ButtonGroup } from '../buttonGroup/ButtonGroup';
import { Button, Separator } from '../buttonGroup';
import type { ButtonGroupItemSize } from '../buttonGroup';
import { Icon, type IconName } from '../Icon';
import { AudioSettingsModal } from './AudioSettingsModal';
import { useTranslation } from 'react-i18next';
import { useAvSettingsStore } from '../../state/avSettings';

function DeviceSelector(props: {
  icon: IconName;
  isOn: boolean;
  onToggle: () => void;
  devices: { id: string; label: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
  labelSelect: string;
  disabled?: boolean;
  title?: string;
}) {
  const { icon, isOn, onToggle, devices, selectedId, onSelect, labelSelect, disabled, title } = props;
  const [open, setOpen] = React.useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  return (
    <div ref={containerRef} style={{ display: 'flex', alignItems: 'center', gap: 1, position: 'relative' }}>
      <Button
        disabled={disabled}
        variant={isOn ? 'primary' : 'default'}
        onClick={onToggle}
        icon={icon}
        iconPosition="only"
        title={title}
        style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
      />
      <Button
        disabled={disabled}
        variant={isOn ? 'primary' : 'default'}
        icon="chevron-up"
        iconPosition="only"
        onClick={() => setOpen(!open)}
        style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, paddingLeft: 4, paddingRight: 4, minWidth: 24 }}
      />
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: 8,
            background: 'var(--panel-bg)',
            color: 'var(--panel-fg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: 4,
            display: 'grid',
            gap: 2,
            minWidth: 220,
            boxShadow: 'var(--shadow)',
            backdropFilter: 'blur(12px)',
            zIndex: 1000,
          }}
        >
          <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--fg-subtle)', fontWeight: 600 }}>
            {labelSelect}
          </div>
          {devices.length === 0 && (
            <div style={{ padding: '8px', fontSize: 13, color: 'var(--fg-subtle)', fontStyle: 'italic' }}>
              Keine Geräte gefunden
            </div>
          )}
          {devices.map((d) => (
            <button
              key={d.id}
              onClick={() => {
                onSelect(d.id);
                setOpen(false);
              }}
              className={`device-selector-item ${d.id === selectedId ? 'selected' : ''}`}
            >
              {d.id === selectedId && <Icon name="check" size="xs" style={{ color: 'var(--speaking-color)' }} />}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PushToTalkButton({ disabled }: { disabled?: boolean }) {
  const pttOn = useAvSettingsStore((s) => s.settings.pushToTalk);
  const pttKey = useAvSettingsStore((s) => s.settings.pushToTalkKey) || 'Space';
  const keyLabel = pttKey === 'Space' ? 'Leertaste' : pttKey;
  return (
    <Button
      disabled={disabled}
      active={pttOn}
      onClick={() => useAvSettingsStore.getState().setSetting('pushToTalk', !pttOn)}
      icon="radio"
      iconPosition="only"
      title={pttOn ? `Push-to-Talk (${keyLabel} halten)` : 'Push-to-Talk aktivieren'}
    />
  );
}

type AVBarProps = {
  size?: ButtonGroupItemSize;
  micOn: boolean;
  camOn: boolean;
  shareOn: boolean;
  dndOn: boolean;
  devices: { mics: { id: string; label: string }[]; cams: { id: string; label: string }[] };
  selectedMicId: string;
  selectedCamId: string;
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
};

function ShareButton({
  shareOn,
  dndOn,
  onToggleShare,
  t,
}: {
  shareOn: boolean;
  dndOn: boolean;
  onToggleShare: () => void | Promise<void>;
  t: (k: string) => string;
}) {
  return (
    <Button
      disabled={dndOn}
      variant={shareOn ? 'primary' : 'default'}
      onClick={() => {
        void onToggleShare();
      }}
      iconPosition="left"
    >
      <Icon name="screen-share" />
      <span>{shareOn ? t('av.share.stop') : t('av.share.start')}</span>
    </Button>
  );
}

export function AVBar(props: AVBarProps) {
  const {
    size = 'md',
    micOn,
    camOn,
    shareOn,
    dndOn,
    devices,
    selectedMicId,
    selectedCamId,
    onToggleMic,
    onSelectMic,
    onToggleCam,
    onSelectCam,
    onToggleShare,
    onToggleDnd,
    cameraManual,
    onRecenter,
    className,
    style,
  } = props;

  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const showSettings =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_FEATURE_AV_SETTINGS !== 'false';
  const { t } = useTranslation();
  const mod = navigator.platform?.startsWith('Mac') ? '⌘' : 'Ctrl';

  return (
    <ButtonGroup size={size} {...(className ? { className } : {})} {...(style ? { style } : {})}>
      <DeviceSelector
        icon={micOn ? 'microphone' : 'microphone-off'}
        isOn={micOn}
        onToggle={() => {
          void onToggleMic();
        }}
        devices={devices.mics}
        selectedId={selectedMicId}
        onSelect={(id) => {
          void onSelectMic(id);
        }}
        labelSelect={t('av.selectMic')}
        disabled={dndOn}
        title={`${micOn ? t('av.micOff') : t('av.micOn')} (${mod}+D)`}
      />
      <Separator variant="vertical" />
      <DeviceSelector
        icon={camOn ? 'video' : 'video-off'}
        isOn={camOn}
        onToggle={() => {
          void onToggleCam();
        }}
        devices={devices.cams}
        selectedId={selectedCamId}
        onSelect={(id) => {
          void onSelectCam(id);
        }}
        labelSelect={t('av.selectCam')}
        disabled={dndOn}
      />
      <Separator variant="vertical" />
      <ShareButton shareOn={shareOn} dndOn={dndOn} onToggleShare={onToggleShare} t={t} />
      <Separator variant="vertical" />
      <Button
        active={dndOn}
        onClick={() => {
          void onToggleDnd();
        }}
        icon="bell-off"
        iconPosition="only"
        title={`${dndOn ? t('av.dnd.on') : t('av.dnd.off')} (${mod}+Shift+U)`}
      />
      <PushToTalkButton disabled={dndOn} />
      {cameraManual && (
        <Button disabled={dndOn} onClick={onRecenter} icon="recenter" iconPosition="only" title={t('av.recenter')} />
      )}
      {showSettings && (
        <>
          <Separator variant="vertical" />
          <Button
            onClick={() => setSettingsOpen(true)}
            icon="settings"
            iconPosition="only"
            title={t('settings.title')}
          />
          <AudioSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
        </>
      )}
    </ButtonGroup>
  );
}
