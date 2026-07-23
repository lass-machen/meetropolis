import { AVBar } from '../../../ui/av/AVBar';

interface AVControlBarProps {
  editorActive: boolean;
  avState: { mic: boolean; cam: boolean; share: boolean; dnd: boolean; micPending?: boolean };
  devices: { mics: { id: string; label: string }[]; cams: { id: string; label: string }[] };
  selectedMicId: string;
  selectedCamId: string;
  cameraManual: boolean;
  onToggleMic: () => Promise<void>;
  onSelectMic: (id: string) => Promise<void>;
  onToggleCam: () => Promise<void>;
  onSelectCam: (id: string) => Promise<void>;
  onToggleShare: () => Promise<void>;
  onToggleDnd: () => Promise<void>;
  onRecenter: () => void;
}

export function AVControlBar({
  editorActive,
  avState,
  devices,
  selectedMicId,
  selectedCamId,
  cameraManual,
  onToggleMic,
  onSelectMic,
  onToggleCam,
  onSelectCam,
  onToggleShare,
  onToggleDnd,
  onRecenter,
}: AVControlBarProps) {
  if (editorActive) {
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        left: 0,
        right: 0,
        zIndex: 30,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div style={{ pointerEvents: 'auto', maxWidth: 'calc(100vw - 32px)', display: 'flex', justifyContent: 'center' }}>
        <AVBar
          size="md"
          micOn={avState.mic}
          micPending={avState.micPending ?? false}
          camOn={avState.cam}
          shareOn={avState.share}
          dndOn={avState.dnd}
          devices={devices}
          selectedMicId={selectedMicId}
          selectedCamId={selectedCamId}
          onToggleMic={onToggleMic}
          onSelectMic={onSelectMic}
          onToggleCam={onToggleCam}
          onSelectCam={onSelectCam}
          onToggleShare={onToggleShare}
          onToggleDnd={onToggleDnd}
          cameraManual={cameraManual}
          onRecenter={onRecenter}
        />
      </div>
    </div>
  );
}
