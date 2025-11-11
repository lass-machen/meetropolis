import * as React from 'react';
import { ParticipantsGrid } from '../../ui/user/ParticipantsGrid';
import { ParticipantOverlay } from '../../ui/user/ParticipantOverlay';
import { HudPanel } from '../../ui/hud/HudPanel';

type Participant = { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen'; volume?: number };

type Props = {
  hud: { zone?: string; follow?: string | null; avRoom?: string | null };
  editorActive: boolean;
  avDnd: boolean;
  participants: Participant[];
  gridExpanded: boolean;
  onToggleExpand: () => void;
  selectedSid: string | null;
  onSelectSid: (sid: string | null) => void;
  getRoom: () => any;
  overlayZoom: number;
  onZoom: (z: number) => void;
};

export function Overlays({ hud, editorActive, avDnd, participants, gridExpanded, onToggleExpand, selectedSid, onSelectSid, getRoom, overlayZoom, onZoom }: Props) {
  // Halte die letzte nicht-leere Teilnehmerliste für kurze Zeit (Reconnect-Grace),
  // um visuelles Flackern bei kurzzeitigen Verbindungsabbrüchen zu vermeiden.
  const lastNonEmptyRef = React.useRef<Participant[]>(participants);
  const [stableParticipants, setStableParticipants] = React.useState<Participant[]>(participants);
  const graceTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
    if (participants.length > 0) {
      lastNonEmptyRef.current = participants;
      setStableParticipants(participants);
      return;
    }
    // Teilnehmerliste ist leer:  Entprellen für kurze Zeit
    // (z. B. während Colyseus-Reconnects), um UI-Flackern zu verhindern.
    setStableParticipants(lastNonEmptyRef.current);
    graceTimerRef.current = window.setTimeout(() => {
      setStableParticipants(participants);
      graceTimerRef.current = null;
    }, 2000);
    return () => {
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
    };
  }, [participants]);

  return (
    <>
      {!editorActive && !avDnd && (
        <ParticipantsGrid
          participants={stableParticipants}
          expanded={gridExpanded}
          onToggleExpand={onToggleExpand}
          selectedSid={selectedSid}
          onSelect={(sid) => onSelectSid(sid)}
          roomGetter={getRoom}
        />
      )}
      <HudPanel hud={hud} />
      {!editorActive && !avDnd && selectedSid && (() => {
        const pick = participants.find(p => p.sid === selectedSid);
        if (!pick) return null;
        return (
          <ParticipantOverlay
            participant={pick}
            roomGetter={getRoom}
            zoom={overlayZoom}
            onZoom={onZoom}
            onClose={() => { onSelectSid(null); onZoom(1); }}
          />
        );
      })()}
    </>
  );
}


