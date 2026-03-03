import { useEffect, useState } from 'react';
import { UserCardContainer } from './UserCard';
import { ParticipantCard } from './ParticipantCard';
import { FAIcon } from '../FAIcon';
import { useTranslation } from 'react-i18next';

export type UIParticipant = { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen'; volume?: number; dnd?: boolean; avatarId?: string };

export function ParticipantsGrid(props: {
  participants: UIParticipant[];
  expanded: boolean;
  onToggleExpand: () => void;
  selectedSid: string | null;
  onSelect: (sid: string | null) => void;
  roomGetter: () => any | undefined;
}) {
  const { participants, expanded, onToggleExpand, selectedSid, onSelect, roomGetter } = props;
  const { t } = useTranslation();
  
  const [maxCols, setMaxCols] = useState(4);

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      if (w < 700) setMaxCols(1);
      else if (w < 1100) setMaxCols(2);
      else if (w < 1600) setMaxCols(3);
      else setMaxCols(4);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const count = participants.length || 1;
  const cols = Math.max(1, Math.min(count, expanded ? Math.min(maxCols, 3) : maxCols));
  const gap = expanded ? 18 : 12;
  return (
    <UserCardContainer
      expanded={expanded}
      columns={cols}
      gap={gap}
      onToggleExpand={onToggleExpand}
      expandButton={expanded ? <FAIcon size="sm" name="down-left-and-up-right-to-center" variant="solid" ariaLabel={t('participantsGrid.collapse')} /> : <FAIcon size="sm" name="up-right-and-down-left-from-center" variant="solid" ariaLabel={t('participantsGrid.expand')} />}
    >
      {participants.map(p => (
        <div key={p.sid} onClick={() => onSelect(selectedSid === p.sid ? null : p.sid)} style={{ cursor: 'pointer', transition: 'transform 180ms ease' }}>
          <ParticipantCard part={p} roomGetter={roomGetter} compact={!expanded} collapsed={!expanded} />
        </div>
      ))}
    </UserCardContainer>
  );
}


