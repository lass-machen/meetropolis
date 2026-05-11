import React from 'react';
import type { Room } from 'livekit-client';
import { useTranslation } from 'react-i18next';
import { CompactCard } from './card/CompactCard';
import { ExpandedCard } from './card/ExpandedCard';
import { useVideoTrackAttachment } from './card/useVideoTrackAttachment';
import type { PartType } from './card/types';

export function ParticipantCard(props: {
  part: PartType;
  roomGetter: () => Room | undefined;
  compact?: boolean;
  full?: boolean;
  zoom?: number;
  collapsed?: boolean;
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const { part, roomGetter, full, zoom = 1, collapsed } = props;
  const [hover, setHover] = React.useState(false);
  const { t } = useTranslation('common');
  const { isVideoRendering, isLocal } = useVideoTrackAttachment(part, roomGetter, videoRef);

  const volume = part.volume ?? 1;
  const opacity = isLocal ? 1 : 0.4 + volume * 0.6;
  const isDnd = !!part.dnd;
  const disabled = (!isLocal && volume <= 0.1) || isDnd;

  if (collapsed) {
    return (
      <CompactCard
        part={part}
        isVideoRendering={isVideoRendering}
        opacity={opacity}
        disabled={disabled}
        videoRef={videoRef}
        t={t}
      />
    );
  }
  return (
    <ExpandedCard
      part={part}
      isVideoRendering={isVideoRendering}
      isLocal={isLocal}
      hover={hover}
      setHover={setHover}
      opacity={opacity}
      disabled={disabled}
      full={full}
      zoom={zoom}
      videoRef={videoRef}
      roomGetter={roomGetter}
      t={t}
    />
  );
}
