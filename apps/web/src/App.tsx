import React, { useEffect, useRef } from 'react';
import { createPhaserGame, destroyPhaserGame } from './game/phaserGame';
import { gameBridge } from './game/bridge';
import { joinWorld } from './lib/colyseus';
import { joinLivekitRoom } from './lib/livekit';
import { AVManager } from './av/avManager';
import { BubbleManager } from './game/bubbleManager';
import { ZoneManager } from './game/zoneManager';

export function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const colyseusRef = useRef<any>(null);
  const livekitRef = useRef<any>(null);
  const avRef = useRef<AVManager | null>(null);
  const bubbleRef = useRef<BubbleManager | null>(null);
  const zoneRef = useRef<ZoneManager | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const game = createPhaserGame(containerRef.current);

    // Colyseus World
    (async () => {
      const room = await joinWorld(import.meta.env.VITE_API_BASE);
      colyseusRef.current = room;
      // Lokale Bewegung → Server
      gameBridge.onLocalMove = (p) => room.send('move', p);
      // Remote-Players spiegeln
      room.onStateChange((state: any) => {
        const players: Record<string, { x: number; y: number; direction: any }> = {};
        state.players?.forEach?.((value: any, key: string) => {
          players[key] = { x: value.x, y: value.y, direction: value.direction };
        });
        gameBridge.syncRemotePlayers(players);
      });
    })();

    // LiveKit Basis (Haupt-Raum)
    (async () => {
      try {
        const identity = `${Math.random().toString(36).slice(2)}`;
        avRef.current = new AVManager({
          baseUrl: import.meta.env.VITE_API_BASE,
          identity,
          useVideo: import.meta.env.VITE_FEATURE_VOICE_ONLY !== 'true',
        });
        livekitRef.current = await joinLivekitRoom({
          baseUrl: import.meta.env.VITE_API_BASE,
          tokenEndpoint: '/livekit/token',
          roomName: 'lobby',
          identity,
          useVideo: import.meta.env.VITE_FEATURE_VOICE_ONLY !== 'true'
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('LiveKit connect failed', e);
      }
    })();

    // Bubble & Zonen Manager verdrahten (Stub: keine echten Zonen eingetragen)
    bubbleRef.current = new BubbleManager(64, avRef.current!);
    zoneRef.current = new ZoneManager([], avRef.current!);
    return () => {
      destroyPhaserGame(game);
      colyseusRef.current?.leave?.();
      livekitRef.current?.disconnect?.();
    };
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#1b1b1b' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

