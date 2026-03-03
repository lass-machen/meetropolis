import * as React from 'react';
import { ParticipantsGrid } from '../../ui/user/ParticipantsGrid';
import { ParticipantOverlay } from '../../ui/user/ParticipantOverlay';
import { HudPanel } from '../../ui/hud/HudPanel';
import { TopRightMenu } from '../../ui/app/TopRightMenu';

type Participant = { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen'; volume?: number };

/** Shallow-compare two participant arrays by length + per-entry SID, hasVideo, hasMic, isSpeaking, volume. */
function participantsEqual(a: Participant[], b: Participant[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i];
    const pb = b[i];
    if (
      pa.sid !== pb.sid ||
      pa.hasVideo !== pb.hasVideo ||
      pa.hasMic !== pb.hasMic ||
      pa.isSpeaking !== pb.isSpeaking ||
      pa.volume !== pb.volume
    ) {
      return false;
    }
  }
  return true;
}

type TopRightMenuProps = React.ComponentProps<typeof TopRightMenu>;

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
  // TopRightMenu props
  topRightMenu?: TopRightMenuProps;
};

export function Overlays({ hud, editorActive, avDnd, participants, gridExpanded, onToggleExpand, selectedSid, onSelectSid, getRoom, overlayZoom, onZoom, topRightMenu }: Props) {
  // Halte die letzte nicht-leere Teilnehmerliste für kurze Zeit (Reconnect-Grace),
  // um visuelles Flackern bei kurzzeitigen Verbindungsabbrüchen zu vermeiden.
  const lastNonEmptyRef = React.useRef<Participant[]>(participants);
  const [stableParticipants, setStableParticipants] = React.useState<Participant[]>(participants);
  const stableRef = React.useRef<Participant[]>(stableParticipants);
  const graceTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
    if (participants.length > 0) {
      lastNonEmptyRef.current = participants;
      // Only update state when participants actually changed to avoid render loops.
      if (!participantsEqual(stableRef.current, participants)) {
        stableRef.current = participants;
        setStableParticipants(participants);
      }
      return;
    }
    // Teilnehmerliste ist leer:  Entprellen für kurze Zeit
    // (z. B. während Colyseus-Reconnects), um UI-Flackern zu verhindern.
    if (!participantsEqual(stableRef.current, lastNonEmptyRef.current)) {
      stableRef.current = lastNonEmptyRef.current;
      setStableParticipants(lastNonEmptyRef.current);
    }
    graceTimerRef.current = window.setTimeout(() => {
      if (!participantsEqual(stableRef.current, participants)) {
        stableRef.current = participants;
        setStableParticipants(participants);
      }
      graceTimerRef.current = null;
    }, 2000);
    return () => {
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
    };
  }, [participants]);

  const showParticipants = !editorActive && !avDnd;
  const showTopRightMenu = topRightMenu && !selectedSid; // Hide menu when overlay is open

  return (
    <>
      {/* Top Header Bar - flex layout for participants + menu */}
      {(showParticipants || showTopRightMenu) && (
        <div className="top-header-bar">
          {/* Left spacer for symmetry */}
          <div className="top-header-spacer" />

          {/* Center: Participants Grid */}
          <div className="top-header-center">
            {showParticipants && (
              <ParticipantsGrid
                participants={stableParticipants}
                expanded={gridExpanded}
                onToggleExpand={onToggleExpand}
                selectedSid={selectedSid}
                onSelect={(sid) => onSelectSid(sid)}
                roomGetter={getRoom}
              />
            )}
          </div>

          {/* Right: TopRightMenu */}
          <div className="top-header-right">
            {showTopRightMenu && <TopRightMenu {...topRightMenu} />}
          </div>
        </div>
      )}

      {/* HudPanel hidden when fullscreen overlay is open */}
      {!selectedSid && <HudPanel hud={hud} />}

      {/* Fullscreen Participant Overlay */}
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


