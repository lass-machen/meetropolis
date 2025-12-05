/**
 * MiniWindow Component
 *
 * Zeigt eine kompakte Mini-Ansicht der App für den Tauri Mini-Modus.
 * Enthält:
 * - AV-Steuerung (Mic/Cam/DND)
 * - Anzeige anderer User
 * - Button zum Maximieren
 * - Drag-Handle
 */

import React from 'react';
import { FAIcon } from '../FAIcon';

interface MiniWindowUser {
  identity: string;
  name: string;
  hasVideo: boolean;
  hasMic: boolean;
  isSpeaking: boolean;
}

interface MiniWindowProps {
  micOn: boolean;
  camOn: boolean;
  dndOn: boolean;
  shareOn: boolean;
  onlineUsers?: MiniWindowUser[];
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleDnd: () => void;
  onExpand: () => void;
  onReload: () => void;
}

export function MiniWindow({
  micOn,
  camOn,
  dndOn,
  shareOn,
  onlineUsers = [],
  onToggleMic,
  onToggleCam,
  onToggleDnd,
  onExpand,
  onReload,
}: MiniWindowProps) {
  // Keyboard shortcut: Cmd/Ctrl+M to expand
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        onExpand();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onExpand]);

  const otherUsers = onlineUsers.filter(u => u.hasMic || u.hasVideo);
  const speakingUsers = otherUsers.filter(u => u.isSpeaking);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden',
        userSelect: 'none',
        borderRadius: 8,
      }}
    >
      {/* Drag-Handle (oben) - ganzer oberer Bereich ist draggable */}
      <div
        data-tauri-drag-region="true"
        style={{
          height: 32,
          background: 'rgba(255,255,255,0.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'grab',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            background: 'rgba(255,255,255,0.3)',
          }}
        />
      </div>

      {/* Hauptbereich */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 10,
          gap: 8,
        }}
      >
        {/* Status-Anzeige mit User-Count */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            color: 'rgba(255,255,255,0.7)',
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: dndOn ? '#f59e0b' : shareOn ? '#22c55e' : '#3b82f6',
              boxShadow: `0 0 8px ${dndOn ? '#f59e0b' : shareOn ? '#22c55e' : '#3b82f6'}`,
            }}
          />
          {dndOn ? 'Nicht stören' : shareOn ? 'Teilt Bildschirm' : `${otherUsers.length} online`}
        </div>

        {/* Sprechende User anzeigen */}
        {speakingUsers.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
              color: '#22c55e',
              background: 'rgba(34, 197, 94, 0.1)',
              padding: '3px 8px',
              borderRadius: 12,
            }}
          >
            <FAIcon name="volume-high" variant="solid" size="xs" ariaLabel="Spricht" />
            {speakingUsers.slice(0, 2).map(u => u.name.split(' ')[0]).join(', ')}
            {speakingUsers.length > 2 && ` +${speakingUsers.length - 2}`}
          </div>
        )}

        {/* AV-Controls */}
        <div
          style={{
            display: 'flex',
            gap: 6,
          }}
        >
          {/* Mikrofon */}
          <button
            onClick={onToggleMic}
            disabled={dndOn}
            title={micOn ? 'Mikrofon aus' : 'Mikrofon an'}
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              border: 'none',
              background: micOn ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
              color: micOn ? '#22c55e' : '#ef4444',
              cursor: dndOn ? 'not-allowed' : 'pointer',
              display: 'grid',
              placeItems: 'center',
              opacity: dndOn ? 0.4 : 1,
              transition: 'all 0.15s ease',
            }}
          >
            <FAIcon
              name={micOn ? 'microphone' : 'microphone-slash'}
              variant="solid"
              size="sm"
              ariaLabel={micOn ? 'Mikrofon an' : 'Mikrofon aus'}
            />
          </button>

          {/* Kamera */}
          <button
            onClick={onToggleCam}
            disabled={dndOn}
            title={camOn ? 'Kamera aus' : 'Kamera an'}
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              border: 'none',
              background: camOn ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
              color: camOn ? '#22c55e' : '#ef4444',
              cursor: dndOn ? 'not-allowed' : 'pointer',
              display: 'grid',
              placeItems: 'center',
              opacity: dndOn ? 0.4 : 1,
              transition: 'all 0.15s ease',
            }}
          >
            <FAIcon
              name={camOn ? 'video' : 'video-slash'}
              variant="solid"
              size="sm"
              ariaLabel={camOn ? 'Kamera an' : 'Kamera aus'}
            />
          </button>

          {/* DND */}
          <button
            onClick={onToggleDnd}
            title={dndOn ? 'Nicht stören beenden' : 'Nicht stören aktivieren'}
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              border: 'none',
              background: dndOn ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.1)',
              color: dndOn ? '#f59e0b' : 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            <FAIcon
              name="moon"
              variant="solid"
              size="sm"
              ariaLabel={dndOn ? 'Nicht stören beenden' : 'Nicht stören aktivieren'}
            />
          </button>
        </div>
      </div>

      {/* Untere Leiste */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 10px',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          background: 'rgba(0,0,0,0.2)',
        }}
      >
        {/* Reload Button */}
        <button
          onClick={onReload}
          title="Neu laden"
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            border: 'none',
            background: 'rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            fontSize: 11,
          }}
        >
          <FAIcon name="arrows-rotate" variant="solid" size="xs" ariaLabel="Neu laden" />
        </button>

        {/* Expand Button */}
        <button
          onClick={onExpand}
          title="Zurück zur App (Cmd+M)"
          style={{
            padding: '5px 10px',
            borderRadius: 6,
            border: 'none',
            background: 'rgba(59, 130, 246, 0.3)',
            color: '#60a5fa',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <FAIcon name="up-right-and-down-left-from-center" variant="solid" size="xs" ariaLabel="Maximieren" />
          Zurück
        </button>
      </div>
    </div>
  );
}
