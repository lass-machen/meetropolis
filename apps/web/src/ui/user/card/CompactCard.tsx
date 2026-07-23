import React from 'react';
import { AvatarSprite } from '../AvatarSprite';
import { StatusBadges } from './StatusBadges';
import { displayParticipantName } from './participantUtils';
import type { PartType } from './types';

export function CompactCard({
  part,
  isVideoRendering,
  opacity,
  disabled,
  videoRef,
  t,
}: {
  part: PartType;
  isVideoRendering: boolean;
  opacity: number;
  disabled: boolean;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  t: (k: string) => string;
}) {
  const pillBorder = part.isSpeaking ? '1px solid rgba(16,185,129,0.75)' : '1px solid rgba(255,255,255,0.22)';
  const pillBg = part.isSpeaking ? 'rgba(50,255,187,0.20)' : 'rgba(255,255,255,0.1)';
  const pillShadow = part.isSpeaking
    ? '0 0 8px -1px rgba(16,185,129,0.80), 0 1px 3px 0 rgba(0,0,0,0.10)'
    : '0 1px 3px rgba(0,0,0,0.1)';

  return (
    <div
      className="uc-pill"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 6,
        borderRadius: 25,
        border: pillBorder,
        background: pillBg,
        boxShadow: pillShadow,
        opacity,
        transition: 'opacity 0.3s ease-in-out, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
        pointerEvents: 'auto',
        filter: disabled ? 'grayscale(90%) brightness(0.8)' : undefined,
      }}
    >
      <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 11,
          lineHeight: '12px',
          fontWeight: 600,
          textShadow: '0 0 1px rgba(0,0,0,0.5)',
          padding: '5px 8px',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 25,
          background: 'rgba(255,255,255,0.1)',
          color: 'var(--fg)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        <span className="uc-pill-avatar">
          <AvatarSprite {...(part.avatarId ? { avatarId: part.avatarId } : {})} size={12} />
        </span>
        {displayParticipantName(part, t)}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <StatusBadges part={part} isVideoRendering={isVideoRendering} t={t} />
      </div>
    </div>
  );
}
