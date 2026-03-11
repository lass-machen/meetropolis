import React from 'react';
import { FAIcon } from '../../../ui/FAIcon';
import { pointInPolygon } from '../../../lib/geom';

interface UIParticipantMini {
  sid: string;
  identity: string;
  hasVideo: boolean;
  hasMic: boolean;
  isSpeaking: boolean;
  media?: 'camera' | 'screen';
}

interface ZoneInfo {
  name: string;
  points: { x: number; y: number }[];
}

interface MiniModeViewProps {
  roster: Array<{ identity: string; name: string; online: boolean; x?: number; y?: number }>;
  uiParticipants: UIParticipantMini[];
  avState: { mic: boolean; cam: boolean; share: boolean; dnd: boolean };
  getDisplayName: (identity: string) => string;
  onJumpTo: (item: { x?: number; y?: number }) => void;
  onToggleMic: () => Promise<void>;
  onToggleCam: () => Promise<void>;
  onToggleDnd: () => Promise<void>;
  onToggleShare: () => Promise<void>;
  onExpand: () => void;
  onExpandWithScreen: (screenSid: string) => void;
  roomGetter: () => any | undefined;
  getZones: () => ZoneInfo[];
}

function getInitials(name: string): string {
  return (name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
}

function getHue(name: string): number {
  return name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

/** Status badge matching ParticipantCard style (green=on, red=off) */
function Badge({ on, iconOn, iconOff }: { on: boolean; iconOn: string; iconOff: string }) {
  return (
    <div style={{
      width: 22, height: 22, borderRadius: 999,
      display: 'grid', placeItems: 'center',
      background: on ? 'rgba(16,185,129,0.25)' : 'rgba(244,63,94,0.25)',
      border: `1px solid ${on ? 'rgba(16,185,129,0.5)' : 'rgba(244,63,94,0.5)'}`,
    }}>
      <FAIcon name={on ? iconOn : iconOff} variant="solid" size="xs" style={{ fontSize: 9 }} />
    </div>
  );
}

export function MiniModeView({
  roster, uiParticipants, avState, getDisplayName,
  onJumpTo, onToggleMic, onToggleCam, onToggleDnd, onToggleShare, onExpand,
  onExpandWithScreen, roomGetter, getZones,
}: MiniModeViewProps) {
  // Camera participants (from LiveKit) — filter out screen shares
  const cameraParticipants = React.useMemo(
    () => uiParticipants.filter(p => !p.media || p.media === 'camera'),
    [uiParticipants],
  );

  // Screen share participants
  const screenParticipants = React.useMemo(
    () => uiParticipants.filter(p => p.media === 'screen'),
    [uiParticipants],
  );

  // Display names of all participants in cards (for dedup with "Weitere online")
  const participantDisplayNames = React.useMemo(
    () => new Set(cameraParticipants.map(p => p.identity)),
    [cameraParticipants],
  );

  // Online roster users NOT already shown as participant cards
  const otherOnline = React.useMemo(
    () => roster
      .filter(r => {
        if (!r.online) return false;
        const displayName = getDisplayName(r.identity) || r.name;
        return !participantDisplayNames.has(displayName);
      })
      .sort((a, b) => (a.name || a.identity).localeCompare(b.name || b.identity)),
    [roster, participantDisplayNames, getDisplayName],
  );

  // Group "other online" users by zone
  const zoneGrouped = React.useMemo(() => {
    const zones = getZones();
    const groups: Record<string, typeof otherOnline> = {};
    for (const user of otherOnline) {
      let zoneName = '';
      if (typeof user.x === 'number' && typeof user.y === 'number') {
        const zone = zones.find(z => pointInPolygon({ x: user.x!, y: user.y! }, z.points));
        if (zone) zoneName = zone.name;
      }
      if (!groups[zoneName]) groups[zoneName] = [];
      groups[zoneName].push(user);
    }
    return groups;
  }, [otherOnline, getZones]);

  // Roster lookup for quick-travel positions
  const rosterMap = React.useMemo(() => {
    const map: Record<string, { x?: number; y?: number }> = {};
    for (const r of roster) {
      if (r.online) {
        const entry: { x?: number; y?: number } = {};
        if (r.x !== undefined) entry.x = r.x;
        if (r.y !== undefined) entry.y = r.y;
        map[r.identity] = entry;
      }
    }
    return map;
  }, [roster]);

  // Also build a display-name → position lookup for participants
  const participantPosMap = React.useMemo(() => {
    const map: Record<string, { x?: number; y?: number }> = {};
    for (const r of roster) {
      if (r.online) {
        const dn = getDisplayName(r.identity) || r.name;
        const entry: { x?: number; y?: number } = {};
        if (r.x !== undefined) entry.x = r.x;
        if (r.y !== undefined) entry.y = r.y;
        map[dn] = entry;
      }
    }
    return map;
  }, [roster, getDisplayName]);

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#4ade80' }}>
            {roster.filter(r => r.online).length} online
          </span>
        </div>
        <button onClick={onExpand} title="Vollmodus" style={headerBtnStyle}>
          <FAIcon name="up-right-and-down-left-from-center" variant="solid" size="xs" />
        </button>
      </div>

      {/* Scrollable content */}
      <div style={scrollStyle}>
        {/* Participant Cards Grid (camera users + screen shares) */}
        {(cameraParticipants.length > 0 || screenParticipants.length > 0) && (
          <div style={gridStyle}>
            {cameraParticipants.map((p) => (
              <MiniCard
                key={p.sid}
                part={p}
                roomGetter={roomGetter}
                position={rosterMap[p.identity] || participantPosMap[p.identity]}
                onJumpTo={onJumpTo}
              />
            ))}
            {screenParticipants.map((p) => (
              <MiniCard
                key={p.sid}
                part={p}
                roomGetter={roomGetter}
                onScreenClick={() => onExpandWithScreen(p.sid)}
              />
            ))}
          </div>
        )}

        {/* Other online users grouped by zone */}
        {otherOnline.length > 0 && (
          <>
            {Object.entries(zoneGrouped).map(([zoneName, users]) => (
              <React.Fragment key={zoneName}>
                <div style={sectionLabelStyle}>
                  {zoneName || 'Weitere online'}
                </div>
                {users.map((item) => {
                  const displayName = getDisplayName(item.identity) || item.name;
                  const hue = getHue(displayName);
                  const hasPos = typeof item.x === 'number' && typeof item.y === 'number';
                  return (
                    <div
                      key={item.identity}
                      onClick={() => {
                        if (hasPos) {
                          const pos: { x?: number; y?: number } = {};
                          if (item.x !== undefined) pos.x = item.x;
                          if (item.y !== undefined) pos.y = item.y;
                          onJumpTo(pos);
                        }
                      }}
                      style={otherRowStyle}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div style={{
                        width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                        background: `hsla(${hue}, 45%, 42%, 0.9)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 8, fontWeight: 700, color: '#e5e7eb',
                      }}>
                        {getInitials(displayName)}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {displayName}
                      </span>
                      {hasPos && (
                        <FAIcon name="location-arrow" variant="solid" size="xs" style={{ opacity: 0.3, fontSize: 8 }} />
                      )}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </>
        )}

        {/* Empty state */}
        {cameraParticipants.length === 0 && screenParticipants.length === 0 && otherOnline.length === 0 && (
          <div style={emptyStyle}>Niemand online</div>
        )}
      </div>

      {/* AV Control Bar */}
      <div style={avBarStyle}>
        <AvButton active={avState.mic} color="#10b981" onClick={onToggleMic} title={avState.mic ? 'Mute' : 'Unmute'}>
          <FAIcon name={avState.mic ? 'microphone' : 'microphone-slash'} variant="solid" size="sm" />
        </AvButton>
        <AvButton active={avState.cam} color="#3b82f6" onClick={onToggleCam} title={avState.cam ? 'Kamera aus' : 'Kamera an'}>
          <FAIcon name={avState.cam ? 'video' : 'video-slash'} variant="solid" size="sm" />
        </AvButton>
        <AvButton active={avState.share} color="#a855f7" onClick={onToggleShare} title={avState.share ? 'Teilen beenden' : 'Bildschirm teilen'}>
          <FAIcon name={avState.share ? 'display' : 'display'} variant="solid" size="sm" />
        </AvButton>
        <AvButton active={avState.dnd} color="#f43f5e" onClick={onToggleDnd} title={avState.dnd ? 'DND aus' : 'DND an'}>
          <FAIcon name="moon" variant="solid" size="sm" />
        </AvButton>
        <div style={{ flex: 1 }} />
        <button onClick={onExpand} title="Vollmodus" style={expandBtnStyle}>
          <FAIcon name="up-right-and-down-left-from-center" variant="solid" size="xs" />
        </button>
      </div>
    </div>
  );
}

/** Mini version of expanded ParticipantCard with live video */
function MiniCard({ part, roomGetter, position, onJumpTo, onScreenClick }: {
  part: UIParticipantMini;
  roomGetter: () => any | undefined;
  position?: { x?: number; y?: number };
  onJumpTo?: (item: { x?: number; y?: number }) => void;
  onScreenClick?: () => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [isVideoRendering, setIsVideoRendering] = React.useState(false);
  const displayName = part.identity;
  const isScreen = part.media === 'screen';
  const hue = getHue(displayName);
  const hasPos = !isScreen && typeof position?.x === 'number' && typeof position?.y === 'number';

  // Attach video/screen track
  React.useEffect(() => {
    const room: any = roomGetter();
    const el = videoRef.current;
    if (!room || !room.localParticipant || !el) return;

    // Reset
    try { (el as any).srcObject = null; } catch {}
    setIsVideoRendering(false);

    const baseSid = (part.sid || '').split(':')[0];
    const isLocal = room.localParticipant?.sid === baseSid;
    let p: any = isLocal ? room.localParticipant : room.remoteParticipants?.get(baseSid);

    // Fallback: find by identity
    if (!p && !isLocal) {
      const allParticipants = Array.from(room.remoteParticipants?.values() || []);
      const searchIdentity = isScreen && part.identity.endsWith(' – Bildschirm')
        ? part.identity.slice(0, -14)
        : part.identity;
      p = allParticipants.find((participant: any) => {
        const pName = participant.name || participant.identity;
        return pName === searchIdentity;
      }) || allParticipants.find((participant: any) => participant.identity === searchIdentity);
    }

    if (!p || !p.trackPublications) return;

    const pubs: any[] = Array.from(p.trackPublications?.values?.() || []);
    const track = isScreen
      ? pubs.find((pub: any) => (pub?.source || pub?.track?.source) === 'screen_share')?.track
      : pubs.find((pub: any) => (pub?.source || pub?.track?.source) === 'camera')?.track;

    if (!track) return;

    // IMPORTANT: Use raw MediaStreamTrack instead of LiveKit's track.attach/detach.
    // track.attach/detach modifies LiveKit's internal attachment tracking, and when
    // MiniCards unmount (exit mini mode), track.detach() corrupts LiveKit state,
    // causing audio AbortErrors and mic unpublish/republish cycles.
    const mst = track.mediaStreamTrack;
    if (!mst) return;

    try {
      el.srcObject = new MediaStream([mst]);
      el.play().catch(() => {});
      if (el.readyState >= 2) setIsVideoRendering(true);
    } catch {}

    const onPlaying = () => setIsVideoRendering(true);
    const onEmptied = () => setIsVideoRendering(false);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('emptied', onEmptied);

    return () => {
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('emptied', onEmptied);
      try { el.pause(); el.srcObject = null; } catch {}
    };
  }, [part.sid, part.hasVideo, part.media, roomGetter, part.identity, isScreen]);

  const borderColor = part.isSpeaking ? '#10b981' : 'rgba(255,255,255,0.08)';
  const shadow = part.isSpeaking
    ? '0 0 0 2px rgba(16,185,129,0.35), 0 2px 8px rgba(0,0,0,0.2)'
    : '0 2px 8px rgba(0,0,0,0.15)';

  const handleClick = () => {
    if (isScreen && onScreenClick) {
      onScreenClick();
    } else if (hasPos && onJumpTo) {
      onJumpTo({
        ...(position?.x !== undefined ? { x: position.x } : {}),
        ...(position?.y !== undefined ? { y: position.y } : {}),
      });
    }
  };

  return (
    <div
      onClick={handleClick}
      style={{
        position: 'relative',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'rgba(255,255,255,0.05)',
        border: `1px solid ${borderColor}`,
        boxShadow: shadow,
        cursor: (hasPos || isScreen) ? 'pointer' : 'default',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
        minHeight: isScreen ? 60 : 80,
        display: 'flex',
        flexDirection: 'column',
        ...(isScreen ? { gridColumn: '1 / -1' } : {}),
      }}
    >
      {/* Video element (hidden behind content, shown when rendering) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: isScreen ? 'contain' : 'cover',
          opacity: isVideoRendering ? 1 : 0,
          transition: 'opacity 0.3s ease',
          background: '#000',
          borderRadius: 12,
        }}
      />

      {/* Overlay content on top of video */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', flex: 1 }}>
        {/* Top row: Name badge + Status badges */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          padding: '6px 6px 0',
        }}>
          {/* Name badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 7px 3px 3px', borderRadius: 8,
            background: 'rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.1)',
            maxWidth: isScreen ? '80%' : '60%',
          }}>
            {isScreen ? (
              <FAIcon name="display" variant="solid" size="xs" style={{ fontSize: 10, color: '#a855f7' }} />
            ) : (
              <div style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                background: `hsla(${hue}, 45%, 42%, 0.95)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 7, fontWeight: 700, color: '#e5e7eb',
              }}>
                {getInitials(displayName)}
              </div>
            )}
            <span style={{
              fontSize: 10, fontWeight: 600, color: '#e5e7eb',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {displayName}
            </span>
          </div>

          {/* Status badges (only for camera participants) */}
          {!isScreen && (
            <div style={{ display: 'flex', gap: 3 }}>
              <Badge on={part.hasMic} iconOn="microphone" iconOff="microphone-slash" />
              <Badge on={part.hasVideo} iconOn="video" iconOff="video-slash" />
            </div>
          )}
          {isScreen && (
            <div style={{
              padding: '3px 7px', borderRadius: 8,
              background: 'rgba(168,85,247,0.2)', border: '1px solid rgba(168,85,247,0.4)',
              fontSize: 9, fontWeight: 600, color: '#c084fc',
            }}>
              Klick zum Vergrößern
            </div>
          )}
        </div>

        {/* Center: Initials fallback (only shown when no video) */}
        {!isVideoRendering && !isScreen && (
          <div style={{
            flex: 1, display: 'grid', placeItems: 'center',
            padding: '4px 6px 8px',
          }}>
            <span style={{
              fontSize: 13, fontWeight: 600, color: 'var(--panel-fg, #e5e7eb)',
              textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', maxWidth: '100%',
            }}>
              {displayName}
            </span>
          </div>
        )}
        {!isVideoRendering && isScreen && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '4px 6px 8px', gap: 6,
          }}>
            <FAIcon name="display" variant="solid" size="sm" style={{ color: '#a855f7', opacity: 0.6 }} />
            <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(229,231,235,0.5)' }}>
              Bildschirmfreigabe
            </span>
          </div>
        )}
        {/* Spacer when video is rendering (so badges stay at top) */}
        {isVideoRendering && <div style={{ flex: 1 }} />}
      </div>
    </div>
  );
}

function AvButton({ active, color, onClick, title, children }: {
  active: boolean; color: string; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 36, height: 36, borderRadius: '50%',
      border: `1px solid ${active ? color + '55' : 'rgba(255,255,255,0.08)'}`,
      background: active ? color + '30' : 'rgba(255,255,255,0.05)',
      color: active ? color : 'rgba(229,231,235,0.35)',
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.2s ease',
    }}>
      {children}
    </button>
  );
}

// --- Styles ---

const containerStyle: React.CSSProperties = {
  width: '100vw', height: '100vh',
  display: 'flex', flexDirection: 'column',
  background: 'var(--panel-bg, #0f1115)',
  color: 'var(--panel-fg, #e5e7eb)',
  overflow: 'hidden', userSelect: 'none',
};

const headerStyle: React.CSSProperties = {
  height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '0 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
};

const headerBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'rgba(229,231,235,0.5)',
  cursor: 'pointer', padding: 4, borderRadius: 4,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const scrollStyle: React.CSSProperties = {
  flex: 1, overflowY: 'auto', padding: 8,
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 6,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 600, color: 'rgba(229,231,235,0.4)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  padding: '10px 4px 4px',
};

const otherRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '4px 4px', cursor: 'pointer', borderRadius: 6,
  transition: 'background 0.1s ease',
};

const emptyStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  flex: 1, opacity: 0.35, fontSize: 12, fontWeight: 500, height: '100%',
};

const avBarStyle: React.CSSProperties = {
  height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 6, padding: '0 10px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
};

const expandBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: '50%',
  border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.03)',
  color: 'rgba(229,231,235,0.45)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
