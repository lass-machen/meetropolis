import React from 'react';
import type { Room } from 'livekit-client';
import { Icon } from '../../Icon';
import { Button } from '../../system/Button';
import { AvatarSprite } from '../AvatarSprite';
import { StatusBadges } from './StatusBadges';
import { displayParticipantName, performForceMute } from './participantUtils';
import type { PartType } from './types';

export function ExpandedCard({
  part,
  isVideoRendering,
  isLocal,
  hover,
  setHover,
  opacity,
  disabled,
  full,
  zoom,
  videoRef,
  roomGetter,
  t,
}: {
  part: PartType;
  isVideoRendering: boolean;
  isLocal: boolean;
  hover: boolean;
  setHover: React.Dispatch<React.SetStateAction<boolean>>;
  opacity: number;
  disabled: boolean;
  full: boolean | undefined;
  zoom: number;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  roomGetter: () => Room | undefined;
  t: (k: string) => string;
}) {
  const speakingColor = 'var(--speaking-color, #10b981)';
  const borderColor = part.isSpeaking ? speakingColor : 'var(--border)';
  const glow = part.isSpeaking
    ? `0 0 0 2px var(--speaking-glow, rgba(16,185,129,0.35)), var(--shadow)`
    : 'var(--shadow)';
  const isScreen = part.media === 'screen';

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: full ? 'min(calc(100vw - 64px), 1920px)' : '100%',
        maxWidth: full ? undefined : 200,
        maxHeight: full ? 'calc(100vh - 64px)' : undefined,
        aspectRatio: full ? undefined : '16 / 9',
        position: 'relative',
        borderRadius: 14,
        overflow: 'hidden',
        background: 'var(--uc-glass)',
        border: `1px solid ${borderColor}`,
        boxShadow: glow,
        opacity,
        transition: 'opacity 0.3s ease-in-out',
        pointerEvents: 'auto',
        filter: disabled ? 'grayscale(90%) brightness(0.8)' : undefined,
        height: full ? 'auto' : undefined,
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: '100%',
          height: full ? 'auto' : '100%',
          maxHeight: full ? 'calc(100vh - 64px)' : undefined,
          objectFit: isScreen ? 'contain' : full ? 'contain' : 'cover',
          background: 'transparent',
          transform: isLocal && part.media === 'camera' ? `scaleX(-1) scale(${zoom})` : `scale(${zoom})`,
          transformOrigin: 'center center',
          pointerEvents: full ? 'none' : undefined,
        }}
      />
      {!(part.hasVideo || isVideoRendering) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--fg)',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {displayParticipantName(part, t)}
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          background: 'var(--bg-btn-bg, var(--glass))',
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <AvatarSprite {...(part.avatarId ? { avatarId: part.avatarId } : {})} size={12} />
        <div
          style={{
            fontSize: 12,
            color: 'var(--fg)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {displayParticipantName(part, t)}
        </div>
      </div>
      <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 6 }}>
        <StatusBadges part={part} isVideoRendering={isVideoRendering} t={t} />
      </div>
      {!isLocal && hover && part.media === 'camera' && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 10,
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 8,
            zIndex: 5,
          }}
        >
          <Button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void performForceMute(part, roomGetter);
            }}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            aria-label={t('participant.forceMuteTitle')}
            title={t('participant.forceMuteTitle')}
            variant="danger"
          >
            <Icon size="sm" name="microphone-off" ariaLabel={t('participant.forceMute')} />
            {t('participant.forceMute')}
          </Button>
        </div>
      )}
    </div>
  );
}
