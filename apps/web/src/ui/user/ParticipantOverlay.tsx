import React from 'react';
import { useTranslation } from 'react-i18next';
import { ParticipantCard } from './ParticipantCard';

export type UIParticipant = { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen'; volume?: number };

export function ParticipantOverlay(props: {
  participant: UIParticipant;
  roomGetter: () => any | undefined;
  zoom: number;
  onZoom: (next: number) => void;
  onClose: () => void;
}) {
  const { participant, roomGetter, zoom, onZoom, onClose } = props;
  const { t } = useTranslation();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = React.useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = React.useState(false);
  const [panOffset, setPanOffset] = React.useState({ x: 0, y: 0 });
  const dragStartRef = React.useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Track container size for optimal video scaling
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      setContainerSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  // Keyboard shortcuts for zoom
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // Plus/Equals for zoom in
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        onZoom(Math.min(4, +(zoom + 0.25).toFixed(2)));
        return;
      }

      // Minus for zoom out
      if (e.key === '-') {
        e.preventDefault();
        onZoom(Math.max(0.25, +(zoom - 0.25).toFixed(2)));
        return;
      }

      // 0 or 1 to reset zoom
      if (e.key === '0' || e.key === '1') {
        e.preventDefault();
        onZoom(1);
        setPanOffset({ x: 0, y: 0 });
        return;
      }

      // F for "fit to window"
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        onZoom(1);
        setPanOffset({ x: 0, y: 0 });
        return;
      }

      // Arrow keys for panning when zoomed
      if (zoom > 1) {
        const panStep = 50;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setPanOffset(p => ({ ...p, x: p.x + panStep }));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          setPanOffset(p => ({ ...p, x: p.x - panStep }));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setPanOffset(p => ({ ...p, y: p.y + panStep }));
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setPanOffset(p => ({ ...p, y: p.y - panStep }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoom, onZoom, onClose]);

  // Double-click to toggle between 1x and 2x zoom
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (zoom === 1) {
      onZoom(2);
    } else {
      onZoom(1);
      setPanOffset({ x: 0, y: 0 });
    }
  };

  // Mouse wheel zoom (with Ctrl/Cmd or without)
  const handleWheel = (e: React.WheelEvent) => {
    // Always allow zoom on screenshare overlay
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    const newZoom = Math.max(0.25, Math.min(4, +(zoom + delta).toFixed(2)));
    onZoom(newZoom);

    // Reset pan if zooming out to 1x
    if (newZoom <= 1) {
      setPanOffset({ x: 0, y: 0 });
    }
  };

  // Drag to pan when zoomed
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    if (e.button !== 0) return; // Only left click

    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: panOffset.x,
      panY: panOffset.y,
    };
  };

  React.useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPanOffset({
        x: dragStartRef.current.panX + dx,
        y: dragStartRef.current.panY + dy,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Touch support for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    if (zoom <= 1) return;
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    dragStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      panX: panOffset.x,
      panY: panOffset.y,
    };
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const dx = touch.clientX - dragStartRef.current.x;
    const dy = touch.clientY - dragStartRef.current.y;
    setPanOffset({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const isScreen = participant.media === 'screen';

  // Calculate optimal aspect ratio based on container
  const aspectRatio = isScreen ? 16 / 9 : 1;
  const optimalWidth = Math.min(
    containerSize.width - 48,
    (containerSize.height - 48) * aspectRatio,
    1920
  );

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        zIndex: 30,
        backdropFilter: 'blur(4px)',
        cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
      }}
      onClick={() => onClose()}
    >
      {/* Video container */}
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          top: 24,
          bottom: 24,
          left: 24,
          right: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: 12,
        }}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            maxWidth: '100%',
            maxHeight: '100%',
          }}
        >
          <ParticipantCard
            part={participant}
            roomGetter={roomGetter}
            compact={false}
            full
            zoom={zoom}
          />
        </div>
      </div>

      {/* Zoom controls - horizontal compact layout */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          display: 'flex',
          flexDirection: 'row',
          gap: 6,
          alignItems: 'center',
          padding: '6px 8px',
          borderRadius: 10,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.12)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Zoom Out */}
        <button
          title={t('participant.zoomMinus') + ' (-)'}
          onClick={(e) => {
            e.stopPropagation();
            onZoom(Math.max(0.25, +(zoom - 0.25).toFixed(2)));
          }}
          style={{
            padding: 4,
            width: 28,
            height: 28,
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.08)',
            color: '#fff',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            fontSize: 14,
            fontWeight: 300,
          }}
        >
          −
        </button>

        {/* Zoom level indicator */}
        <div
          style={{
            padding: '2px 6px',
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            textAlign: 'center',
            minWidth: 40,
          }}
        >
          {Math.round(zoom * 100)}%
        </div>

        {/* Zoom In */}
        <button
          title={t('participant.zoomPlus') + ' (+)'}
          onClick={(e) => {
            e.stopPropagation();
            onZoom(Math.min(4, +(zoom + 0.25).toFixed(2)));
          }}
          style={{
            padding: 4,
            width: 28,
            height: 28,
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.08)',
            color: '#fff',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            fontSize: 14,
            fontWeight: 300,
          }}
        >
          +
        </button>

        {/* Reset button */}
        <button
          title={t('participant.reset') + ' (0)'}
          onClick={(e) => {
            e.stopPropagation();
            onZoom(1);
            setPanOffset({ x: 0, y: 0 });
          }}
          style={{
            padding: 4,
            width: 28,
            height: 28,
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.08)',
            background: zoom === 1 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)',
            color: '#fff',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            fontSize: 9,
            fontWeight: 600,
          }}
        >
          1:1
        </button>

        {/* Separator */}
        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.15)', margin: '0 2px' }} />

        {/* Close button */}
        <button
          title={t('common.close') + ' (Esc)'}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            padding: 4,
            width: 28,
            height: 28,
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.1)',
            color: '#fff',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            fontSize: 14,
            fontWeight: 300,
          }}
        >
          ✕
        </button>
      </div>

      {/* Keyboard shortcut hints */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 16,
          padding: '8px 16px',
          borderRadius: 8,
          background: 'rgba(0,0,0,0.6)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: 'rgba(255,255,255,0.7)',
          fontSize: 11,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span>Scroll: Zoom</span>
        <span>Doppelklick: 2x</span>
        {zoom > 1 && <span>Ziehen: Verschieben</span>}
        <span>Esc: Schließen</span>
      </div>

      {/* Screenshare indicator */}
      {isScreen && (
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(34, 197, 94, 0.2)',
            border: '1px solid rgba(34, 197, 94, 0.4)',
            color: '#22c55e',
            fontSize: 13,
            fontWeight: 500,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          Bildschirmfreigabe
        </div>
      )}
    </div>
  );
}
