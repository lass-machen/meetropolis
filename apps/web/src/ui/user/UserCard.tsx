import React from 'react';
import { useTranslation } from 'react-i18next';

export type UserCardParticipant = {
  sid: string;
  identity: string;
  hasVideo: boolean;
  hasMic: boolean;
  isSpeaking: boolean;
  media: 'camera' | 'screen';
  volume?: number;
  avatarId?: string;
};

export function UserCardContainer(props: {
  children: React.ReactNode;
  expanded: boolean;
  columns: number;
  gap?: number;
  className?: string;
  style?: React.CSSProperties;
  onToggleExpand?: () => void;
  expandButton?: React.ReactNode;
}) {
  const { children, expanded, columns, gap = 12, className = '', style, onToggleExpand, expandButton } = props;
  const { t } = useTranslation('common');
  const classes = ['uc-container', expanded ? 'uc-expanded' : 'uc-collapsed', className].filter(Boolean).join(' ');
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `repeat(${Math.max(1, columns)}, 1fr)`,
  };
  return (
    <div className={classes} style={style}>
      <div className="uc-grid" style={{ gap, ...gridStyle }}>
        {children}
      </div>
      <button
        className="uc-expand-btn"
        onClick={onToggleExpand}
        title={expanded ? t('common.collapse') : t('common.expand')}
      >
        {expandButton}
      </button>
    </div>
  );
}

export function UserCard(props: {
  participant: UserCardParticipant;
  videoRef?: React.RefObject<HTMLVideoElement>;
  isVideoRendering?: boolean;
  isLocal?: boolean;
  compact?: boolean;
  full?: boolean;
  zoom?: number;
  className?: string;
  style?: React.CSSProperties;
  rightBadges?: React.ReactNode;
  collapsed?: boolean;
}) {
  const {
    participant: part,
    videoRef,
    isVideoRendering,
    isLocal,
    compact,
    full,
    zoom = 1,
    className = '',
    style,
    rightBadges,
    collapsed,
  } = props;
  const { t } = useTranslation('common');
  const volume = part.volume ?? 1;
  const isScreen = part.media === 'screen';
  const displayName = isScreen ? `${part.identity} (${t('participant.screenSuffix')})` : part.identity;
  const isCollapsed = !!collapsed;
  const classes = [
    'uc-card',
    part.isSpeaking ? 'uc-speaking' : '',
    isCollapsed ? 'uc-collapsed' : '',
    full ? 'uc-size-full' : compact ? 'uc-size-compact' : 'uc-size-default',
    isCollapsed || full ? 'uc-aspect-auto' : isScreen ? 'uc-aspect-169' : 'uc-aspect-square',
    !isLocal && volume <= 0.1 ? 'uc-disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  // keep semantic alias if needed later, but avoid unused var
  return (
    <div
      className={classes}
      style={{
        width: isCollapsed ? '100%' : undefined,
        height: isCollapsed ? '100%' : undefined,
        ['--uc-opacity' as any]: isLocal ? 1 : 0.4 + volume * 0.6,
        ['--uc-video-zoom' as any]: zoom,
        ...style,
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={['uc-video', isLocal && part.media === 'camera' ? 'uc-video-mirror' : ''].join(' ')}
      />
      {!(part.hasVideo || isVideoRendering) && <div className="uc-fallback-name">{displayName}</div>}
      <div className="uc-name-badge">
        <div className="uc-name-text">{displayName}</div>
      </div>
      <div className="uc-right-badges">{rightBadges}</div>
    </div>
  );
}
