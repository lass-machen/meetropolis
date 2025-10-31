// React JSX runtime via tsconfig
import { UserCardContainer } from './UserCard';
import { ParticipantCard } from './ParticipantCard';
import { FAIcon } from '../FAIcon';

export type UIParticipant = { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen'; volume?: number };

export function ParticipantsGrid(props: {
  participants: UIParticipant[];
  expanded: boolean;
  onToggleExpand: () => void;
  selectedSid: string | null;
  onSelect: (sid: string | null) => void;
  roomGetter: () => any | undefined;
}) {
  const { participants, expanded, onToggleExpand, selectedSid, onSelect, roomGetter } = props;
  const count = participants.length || 1;
  const cols = Math.max(1, Math.min(count, expanded ? 3 : 4));
  const gap = expanded ? 18 : 12;
  return (
    <UserCardContainer
      expanded={expanded}
      columns={cols}
      gap={gap}
      onToggleExpand={onToggleExpand}
      expandButton={expanded ? <FAIcon size="sm" name="down-left-and-up-right-to-center" variant="solid" ariaLabel="Verkleinern" /> : <FAIcon size="sm" name="up-right-and-down-left-from-center" variant="solid" ariaLabel="Vergrößern" />}
    >
      {participants.map(p => (
        <div key={p.sid} onClick={() => onSelect(selectedSid === p.sid ? null : p.sid)} style={{ cursor: 'pointer', transition: 'transform 180ms ease' }}>
          <ParticipantCard part={p} roomGetter={roomGetter} compact={!expanded} />
        </div>
      ))}
    </UserCardContainer>
  );
}


