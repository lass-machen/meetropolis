import React, { useEffect, useRef } from 'react';
import { createPhaserGame, destroyPhaserGame } from './game/phaserGame';

export function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const game = createPhaserGame(containerRef.current);
    return () => {
      destroyPhaserGame(game);
    };
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#1b1b1b' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

