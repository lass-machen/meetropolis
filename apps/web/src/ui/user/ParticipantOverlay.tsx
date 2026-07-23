import React from 'react';
import type { Room } from 'livekit-client';
import { useTranslation } from 'react-i18next';
import { ParticipantCard } from './ParticipantCard';
import { Icon } from '../Icon';
import { clampPan, resolveWheelAction, stepZoom, type PanOffset } from './overlayZoom';

export type UIParticipant = {
  sid: string;
  identity: string;
  hasVideo: boolean;
  hasMic: boolean;
  isSpeaking: boolean;
  media: 'camera' | 'screen';
  volume?: number;
};

type DragRef = React.MutableRefObject<{ x: number; y: number; panX: number; panY: number }>;
type ClampToStage = (pan: PanOffset, zoom: number) => PanOffset;

const CTRL_BTN_BASE: React.CSSProperties = {
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
};

function useKeyboardShortcuts(
  zoom: number,
  onZoom: (n: number) => void,
  onClose: () => void,
  setPanOffset: React.Dispatch<React.SetStateAction<PanOffset>>,
  clampToStage: ClampToStage,
) {
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        onZoom(stepZoom(zoom, 1));
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        onZoom(stepZoom(zoom, -1));
        return;
      }
      if (e.key === '0' || e.key === '1' || e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        onZoom(1);
        setPanOffset({ x: 0, y: 0 });
        return;
      }
      if (zoom > 1) {
        const panStep = 50;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setPanOffset((p) => clampToStage({ ...p, x: p.x + panStep }, zoom));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          setPanOffset((p) => clampToStage({ ...p, x: p.x - panStep }, zoom));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setPanOffset((p) => clampToStage({ ...p, y: p.y + panStep }, zoom));
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setPanOffset((p) => clampToStage({ ...p, y: p.y - panStep }, zoom));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoom, onZoom, onClose, setPanOffset, clampToStage]);
}

function useDragHandlers(
  zoom: number,
  panOffset: PanOffset,
  setPanOffset: React.Dispatch<React.SetStateAction<PanOffset>>,
  isDragging: boolean,
  setIsDragging: (v: boolean) => void,
  dragStartRef: DragRef,
  clampToStage: ClampToStage,
) {
  React.useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      setPanOffset(
        clampToStage(
          {
            x: dragStartRef.current.panX + (e.clientX - dragStartRef.current.x),
            y: dragStartRef.current.panY + (e.clientY - dragStartRef.current.y),
          },
          zoom,
        ),
      );
    };
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, setPanOffset, setIsDragging, dragStartRef, zoom, clampToStage]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: panOffset.x, panY: panOffset.y };
  };
  const handleTouchStart = (e: React.TouchEvent) => {
    if (zoom <= 1) return;
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    dragStartRef.current = { x: touch.clientX, y: touch.clientY, panX: panOffset.x, panY: panOffset.y };
    setIsDragging(true);
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    const touch = e.touches[0];
    setPanOffset(
      clampToStage(
        {
          x: dragStartRef.current.panX + (touch.clientX - dragStartRef.current.x),
          y: dragStartRef.current.panY + (touch.clientY - dragStartRef.current.y),
        },
        zoom,
      ),
    );
  };
  const handleTouchEnd = () => setIsDragging(false);

  return { handleMouseDown, handleTouchStart, handleTouchMove, handleTouchEnd };
}

function useWheelControls(
  containerRef: React.RefObject<HTMLDivElement | null>,
  zoom: number,
  onZoom: (n: number) => void,
  setPanOffset: React.Dispatch<React.SetStateAction<PanOffset>>,
  clampToStage: ClampToStage,
) {
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;
  const onZoomRef = React.useRef(onZoom);
  onZoomRef.current = onZoom;

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // React registers wheel handlers as passive listeners; preventDefault
    // against browser gestures (history swipe, page zoom, rubber-banding)
    // requires a native non-passive listener.
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const action = resolveWheelAction(e, zoomRef.current);
      if (action.kind === 'zoom') {
        onZoomRef.current(action.zoom);
        if (action.zoom <= 1) setPanOffset({ x: 0, y: 0 });
        return;
      }
      if (action.kind === 'pan') {
        setPanOffset((p) => clampToStage({ x: p.x + action.deltaX, y: p.y + action.deltaY }, zoomRef.current));
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [containerRef, setPanOffset, clampToStage]);
}

function ZoomControls({
  zoom,
  onZoom,
  onClose,
  setPanOffset,
  t,
}: {
  zoom: number;
  onZoom: (n: number) => void;
  onClose: () => void;
  setPanOffset: (p: PanOffset) => void;
  t: (k: string) => string;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Zoom-Steuerung"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
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
    >
      <button
        title={t('participant.zoomMinus') + ' (-)'}
        onClick={(e) => {
          e.stopPropagation();
          onZoom(stepZoom(zoom, -1));
        }}
        style={CTRL_BTN_BASE}
      >
        −
      </button>
      <div
        style={{ padding: '2px 6px', color: '#fff', fontSize: 11, fontWeight: 600, textAlign: 'center', minWidth: 40 }}
      >
        {Math.round(zoom * 100)}%
      </div>
      <button
        title={t('participant.zoomPlus') + ' (+)'}
        onClick={(e) => {
          e.stopPropagation();
          onZoom(stepZoom(zoom, 1));
        }}
        style={CTRL_BTN_BASE}
      >
        +
      </button>
      <button
        title={t('participant.fit') + ' (0)'}
        aria-label={t('participant.fit')}
        onClick={(e) => {
          e.stopPropagation();
          onZoom(1);
          setPanOffset({ x: 0, y: 0 });
        }}
        style={{
          ...CTRL_BTN_BASE,
          background: zoom === 1 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)',
        }}
      >
        <Icon name="maximize" size={14} />
      </button>
      <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.15)', margin: '0 2px' }} />
      <button
        title={t('common.close') + ' (Esc)'}
        aria-label={t('common.close')}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        style={{ ...CTRL_BTN_BASE, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.1)' }}
      >
        <Icon name="xmark" size={14} />
      </button>
    </div>
  );
}

function HintsBar({ zoom }: { zoom: number }) {
  const { t } = useTranslation('common');
  return (
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
        pointerEvents: 'none',
      }}
    >
      <span>{t('participant.hintScroll')}</span>
      <span>{t('participant.hintDoubleClick')}</span>
      {zoom > 1 && <span>{t('participant.hintScrollPan')}</span>}
      {zoom > 1 && <span>{t('participant.hintDrag')}</span>}
      <span>{t('participant.hintEsc')}</span>
    </div>
  );
}

function ScreenshareBadge() {
  const { t } = useTranslation('common');
  return (
    <div
      role="status"
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
        pointerEvents: 'none',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
      {t('participant.screenshareBadge')}
    </div>
  );
}

export function ParticipantOverlay(props: {
  participant: UIParticipant;
  roomGetter: () => Room | undefined;
  zoom: number;
  onZoom: (next: number) => void;
  onClose: () => void;
}) {
  const { participant, roomGetter, zoom, onZoom, onClose } = props;
  const { t } = useTranslation();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [panOffset, setPanOffset] = React.useState<PanOffset>({ x: 0, y: 0 });
  const dragStartRef = React.useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const clampToStage = React.useCallback<ClampToStage>((pan, zoomValue) => {
    const el = containerRef.current;
    if (!el || el.clientWidth === 0 || el.clientHeight === 0) return pan;
    return clampPan(pan, zoomValue, { width: el.clientWidth, height: el.clientHeight });
  }, []);

  // Pan limits shrink with the zoom level; every zoom change must re-clamp
  // the current pan offset or the image can stay stranded off-stage after
  // zooming out via button, keyboard or wheel.
  const handleZoom = React.useCallback(
    (next: number) => {
      onZoom(next);
      setPanOffset((p) => (next <= 1 ? { x: 0, y: 0 } : clampToStage(p, next)));
    },
    [onZoom, clampToStage],
  );

  useKeyboardShortcuts(zoom, handleZoom, onClose, setPanOffset, clampToStage);
  useWheelControls(containerRef, zoom, handleZoom, setPanOffset, clampToStage);
  const { handleMouseDown, handleTouchStart, handleTouchMove, handleTouchEnd } = useDragHandlers(
    zoom,
    panOffset,
    setPanOffset,
    isDragging,
    setIsDragging,
    dragStartRef,
    clampToStage,
  );

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (zoom === 1) handleZoom(2);
    else {
      handleZoom(1);
      setPanOffset({ x: 0, y: 0 });
    }
  };

  const isScreen = participant.media === 'screen';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('participant.overlayClose')}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        zIndex: 30,
        backdropFilter: 'blur(4px)',
        cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
      }}
      onClick={() => onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div
        ref={containerRef}
        role="presentation"
        data-testid="overlay-stage"
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
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <ParticipantCard part={participant} roomGetter={roomGetter} compact={false} full zoom={zoom} pan={panOffset} />
      </div>
      <ZoomControls zoom={zoom} onZoom={handleZoom} onClose={onClose} setPanOffset={setPanOffset} t={t} />
      <HintsBar zoom={zoom} />
      {isScreen && <ScreenshareBadge />}
    </div>
  );
}
