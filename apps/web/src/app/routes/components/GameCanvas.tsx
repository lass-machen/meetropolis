import React from 'react';

interface GameCanvasProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  positionReady: boolean;
  avDnd: boolean;
}

export function GameCanvas({ containerRef, positionReady, avDnd }: GameCanvasProps) {
  if (!positionReady) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--fg-subtle)' }}>
        Starte Welt…
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onContextMenu={(e) => { e.preventDefault(); }}
    >
      {avDnd && (
        <div
          onClick={(e) => { e.stopPropagation(); }}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
          onMouseUp={(e) => { e.stopPropagation(); e.preventDefault(); }}
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
          onPointerUp={(e) => { e.stopPropagation(); e.preventDefault(); }}
          onWheel={(e) => { e.stopPropagation(); e.preventDefault(); }}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(2px) grayscale(0.2)',
            zIndex: 20,
            cursor: 'not-allowed'
          }}
        />
      )}
    </div>
  );
}
