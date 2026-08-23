import * as React from 'react';
import type { Room } from 'livekit-client';
import type { WorldRoom } from '../../types/colyseus';
import { ParticipantsGrid } from '../../ui/user/ParticipantsGrid';
import { ParticipantOverlay } from '../../ui/user/ParticipantOverlay';
import { HudPanel } from '../../ui/hud/HudPanel';
import { TopRightMenu } from '../../ui/app/TopRightMenu';
import type { UiParticipant } from '../../types/participant';

/**
 * Shallow-compare two participant arrays by length + per-entry SID,
 * livekitIdentity, displayName, hasVideo, hasMic, isSpeaking, volume.
 *
 * `livekitIdentity` has to be part of it: a presence-only tile keeps its
 * `col:<id>` SID when the Colyseus-to-LiveKit mapping finally arrives, so
 * comparing SIDs alone would hold the identity-less version and the tile would
 * never resolve to its publisher. `displayName` is compared for the same
 * reason a rename should reach the grid at all.
 */
function participantsEqual(a: UiParticipant[], b: UiParticipant[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i];
    const pb = b[i];
    if (
      pa.sid !== pb.sid ||
      pa.livekitIdentity !== pb.livekitIdentity ||
      pa.displayName !== pb.displayName ||
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
  participants: UiParticipant[];
  gridExpanded: boolean;
  onToggleExpand: () => void;
  selectedSid: string | null;
  onSelectSid: (sid: string | null) => void;
  getRoom: () => Room | undefined;
  overlayZoom: number;
  onZoom: (z: number) => void;
  // TopRightMenu props
  topRightMenu?: TopRightMenuProps;
  // Zone lock props
  colyseusRef?: React.RefObject<WorldRoom | null>;
  mySessionId?: string;
};

/**
 * Hold the last non-empty participant list briefly (reconnect grace) to
 * avoid visual flicker on transient disconnects.
 */
function useStableParticipants(participants: UiParticipant[]): UiParticipant[] {
  const lastNonEmptyRef = React.useRef<UiParticipant[]>(participants);
  const [stableParticipants, setStableParticipants] = React.useState<UiParticipant[]>(participants);
  const stableRef = React.useRef<UiParticipant[]>(stableParticipants);
  const graceTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
    if (participants.length > 0) {
      lastNonEmptyRef.current = participants;
      if (!participantsEqual(stableRef.current, participants)) {
        stableRef.current = participants;
        setStableParticipants(participants);
      }
      return;
    }
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

  return stableParticipants;
}

/**
 * Is the fullscreen participant view showing?
 *
 * Exported so the caller can react to it without restating the condition — the
 * world view hides its banners while this is true, and a second copy of the
 * rule would eventually disagree with this one.
 */
export function isFullscreenOverlayOpen(state: {
  editorActive: boolean;
  avDnd: boolean;
  selectedSid: string | null;
}): boolean {
  return !state.editorActive && !state.avDnd && !!state.selectedSid;
}

function FullscreenOverlay({
  participants,
  selectedSid,
  getRoom,
  overlayZoom,
  onZoom,
  onSelectSid,
}: {
  participants: UiParticipant[];
  selectedSid: string;
  getRoom: () => Room | undefined;
  overlayZoom: number;
  onZoom: (z: number) => void;
  onSelectSid: (sid: string | null) => void;
}) {
  const pick = participants.find((p) => p.sid === selectedSid);
  if (!pick) return null;
  return (
    <ParticipantOverlay
      participant={pick}
      roomGetter={getRoom}
      zoom={overlayZoom}
      onZoom={onZoom}
      onClose={() => {
        onSelectSid(null);
        onZoom(1);
      }}
    />
  );
}

export function Overlays({
  hud,
  editorActive,
  avDnd,
  participants,
  gridExpanded,
  onToggleExpand,
  selectedSid,
  onSelectSid,
  getRoom,
  overlayZoom,
  onZoom,
  topRightMenu,
  colyseusRef,
  mySessionId,
}: Props) {
  const stableParticipants = useStableParticipants(participants);

  const showParticipants = !editorActive && !avDnd;
  const showTopRightMenu = topRightMenu && !selectedSid; // Hide menu when overlay is open

  return (
    <>
      {(showParticipants || showTopRightMenu) && (
        <div className="top-header-bar">
          <div className="top-header-spacer" />
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
          <div className="top-header-right">{showTopRightMenu && <TopRightMenu {...topRightMenu} />}</div>
        </div>
      )}

      {!selectedSid && <HudPanel hud={hud} colyseusRef={colyseusRef} mySessionId={mySessionId} />}

      {isFullscreenOverlayOpen({ editorActive, avDnd, selectedSid }) && selectedSid && (
        <FullscreenOverlay
          participants={participants}
          selectedSid={selectedSid}
          getRoom={getRoom}
          overlayZoom={overlayZoom}
          onZoom={onZoom}
          onSelectSid={onSelectSid}
        />
      )}
    </>
  );
}
