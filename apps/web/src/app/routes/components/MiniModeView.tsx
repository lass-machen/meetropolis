import React from 'react';
import { FAIcon } from '../../../ui/FAIcon';

interface MiniModeViewProps {
  roster: Array<{ identity: string; name: string; online: boolean; x?: number; y?: number }>;
  uiParticipants: Array<{ sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean }>;
  avState: { mic: boolean; cam: boolean; share: boolean; dnd: boolean };
  getDisplayName: (identity: string) => string;
  onJumpTo: (item: { x?: number; y?: number }) => void;
  onToggleMic: () => Promise<void>;
  onToggleCam: () => Promise<void>;
  onToggleDnd: () => Promise<void>;
  onExpand: () => void;
}

function getInitials(name: string): string {
  return (name || '?')
    .split(' ')
    .map(p => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function getHue(name: string): number {
  return name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

export function MiniModeView({
  roster,
  uiParticipants,
  avState,
  getDisplayName,
  onJumpTo,
  onToggleMic,
  onToggleCam,
  onToggleDnd,
  onExpand,
}: MiniModeViewProps) {
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);

  const onlineRoster = React.useMemo(
    () => roster.filter(r => r.online),
    [roster],
  );

  // Build a lookup from identity -> participant info
  const participantMap = React.useMemo(() => {
    const map: Record<string, { hasMic: boolean; hasVideo: boolean; isSpeaking: boolean }> = {};
    for (const p of uiParticipants) {
      map[p.identity] = { hasMic: p.hasMic, hasVideo: p.hasVideo, isSpeaking: p.isSpeaking };
    }
    return map;
  }, [uiParticipants]);

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--panel-bg, #0f1115)',
      color: 'var(--panel-fg, #e5e7eb)',
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes speakingGlow {
          0%, 100% { box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.3); }
          50% { box-shadow: 0 0 8px 3px rgba(34, 197, 94, 0.5); }
        }
      `}</style>

      {/* Header */}
      <div style={{
        height: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em' }}>
          Meetropolis
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: '#22c55e',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.8 }}>
            {onlineRoster.length}
          </span>
        </div>
        <button
          onClick={onExpand}
          title="Expand"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--panel-fg, #e5e7eb)',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.6,
            transition: 'opacity 0.15s ease',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.6'; }}
        >
          <FAIcon name="up-right-and-down-left-from-center" variant="solid" size="sm" />
        </button>
      </div>

      {/* Participant List */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}>
        {onlineRoster.length === 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            opacity: 0.4,
            fontSize: 13,
            fontWeight: 500,
          }}>
            Niemand online
          </div>
        ) : (
          onlineRoster.map((item, idx) => {
            const pInfo = participantMap[item.identity];
            const isSpeaking = pInfo?.isSpeaking ?? false;
            const hasMic = pInfo?.hasMic ?? false;
            const hasVideo = pInfo?.hasVideo ?? false;
            const displayName = getDisplayName(item.identity) || item.name;
            const hue = getHue(displayName);
            const initials = getInitials(displayName);
            const isHovered = hoveredIdx === idx;

            return (
              <button
                key={item.identity}
                onClick={() => onJumpTo({
                  ...(item.x !== undefined ? { x: item.x } : {}),
                  ...(item.y !== undefined ? { y: item.y } : {}),
                })}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: isHovered ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: 10,
                  padding: '8px 10px',
                  transition: 'background 0.15s ease',
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                  color: 'inherit',
                  fontFamily: 'inherit',
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: `hsla(${hue}, 45%, 40%, 0.9)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--panel-fg, #e5e7eb)',
                  flexShrink: 0,
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  animation: isSpeaking ? 'speakingGlow 1.5s ease-in-out infinite' : 'none',
                }}>
                  {initials}
                </div>

                {/* Name */}
                <span style={{
                  flex: 1,
                  fontSize: 13,
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {displayName}
                </span>

                {/* Mic/Cam badges */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                  {hasMic && (
                    <FAIcon
                      name="microphone"
                      variant="solid"
                      size="xs"
                      style={{ opacity: 0.5, color: '#4ade80' }}
                    />
                  )}
                  {hasVideo && (
                    <FAIcon
                      name="video"
                      variant="solid"
                      size="xs"
                      style={{ opacity: 0.5, color: '#60a5fa' }}
                    />
                  )}
                  {isSpeaking && (
                    <div style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: '#22c55e',
                      flexShrink: 0,
                    }} />
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* AV Control Bar */}
      <div style={{
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '0 12px',
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
        flexShrink: 0,
      }}>
        {/* Mic Toggle */}
        <button
          onClick={onToggleMic}
          title={avState.mic ? 'Mute' : 'Unmute'}
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            background: avState.mic ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.06)',
            color: avState.mic ? '#4ade80' : 'rgba(229, 231, 235, 0.4)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s ease',
            backdropFilter: 'blur(8px)',
          }}
        >
          <FAIcon
            name={avState.mic ? 'microphone' : 'microphone-slash'}
            variant="solid"
            size="sm"
          />
        </button>

        {/* Cam Toggle */}
        <button
          onClick={onToggleCam}
          title={avState.cam ? 'Camera Off' : 'Camera On'}
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            background: avState.cam ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.06)',
            color: avState.cam ? '#60a5fa' : 'rgba(229, 231, 235, 0.4)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s ease',
            backdropFilter: 'blur(8px)',
          }}
        >
          <FAIcon
            name={avState.cam ? 'video' : 'video-slash'}
            variant="solid"
            size="sm"
          />
        </button>

        {/* DND Toggle */}
        <button
          onClick={onToggleDnd}
          title={avState.dnd ? 'DND Off' : 'DND On'}
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            background: avState.dnd ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.06)',
            color: avState.dnd ? '#ef4444' : 'rgba(229, 231, 235, 0.4)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s ease',
            backdropFilter: 'blur(8px)',
          }}
        >
          <FAIcon
            name="moon"
            variant="solid"
            size="sm"
          />
        </button>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Expand button */}
        <button
          onClick={onExpand}
          title="Expand"
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(255, 255, 255, 0.04)',
            color: 'var(--panel-fg, #e5e7eb)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.6,
            transition: 'opacity 0.15s ease',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.6'; }}
        >
          <FAIcon name="up-right-and-down-left-from-center" variant="solid" size="xs" />
        </button>
      </div>
    </div>
  );
}
