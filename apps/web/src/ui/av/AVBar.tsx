import React from 'react';
import { ButtonGroup } from '../buttonGroup/ButtonGroup';
import { Button, Separator, Spacer } from '../buttonGroup';
import type { ButtonGroupItemSize } from '../buttonGroup';
import { FAIcon } from '../FAIcon';

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

  return (
    <ButtonGroup size={size} className={className} style={style}>
      <Button active={micOn} onClick={onToggleMic} icon={micOn ? 'microphone' : 'microphone-slash'} iconPosition="only"></Button>
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
        <option value="" disabled>Mic wählen…</option>
        {devices.mics.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>

      <Separator variant="vertical" />

      <Button active={camOn} onClick={onToggleCam} icon={camOn ? 'video' : 'video-slash'} iconPosition="only" />
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
        <option value="" disabled>Kamera wählen…</option>
        {devices.cams.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>

      <Separator variant="vertical" />

      <Button active={shareOn} onClick={onToggleShare} iconPosition="left">
        <FAIcon name="screencast" variant="solid" />
        <span>{shareOn ? 'Screenshare stoppen' : 'Screenshare starten'}</span>
      </Button>

      <Separator variant="vertical" />

      <Button active={dndOn} onClick={onToggleDnd} icon="bell-slash" iconPosition="only" title={dndOn ? 'Bitte nicht stören: an' : 'Bitte nicht stören: aus'} />
      {cameraManual && (
        <Button onClick={onRecenter} icon="location-crosshairs" iconPosition="only" title="Zentrieren" />
      )}
    </ButtonGroup>
  );
}


