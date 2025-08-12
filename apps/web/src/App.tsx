import React, { useEffect, useRef } from 'react';
import { createPhaserGame, destroyPhaserGame } from './game/phaserGame';
import { gameBridge } from './game/bridge';
import { joinWorld } from './lib/colyseus';
import { joinLivekitRoom } from './lib/livekit';
import { AVManager } from './av/avManager';
import { BubbleManager } from './game/bubbleManager';
import { FollowManager } from './game/followManager';
import { ZoneManager } from './game/zoneManager';

export function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const colyseusRef = useRef<any>(null);
  const livekitRef = useRef<any>(null);
  const avRef = useRef<AVManager | null>(null);
  const bubbleRef = useRef<BubbleManager | null>(null);
  const zoneRef = useRef<ZoneManager | null>(null);
  const followRef = useRef<import('./game/followManager').FollowManager | null>(null);
  const localPosRef = useRef<{ id: string; x: number; y: number }>({ id: '', x: 0, y: 0 });
  const remotesRef = useRef<Record<string, { x: number; y: number }>>({});
  const [hud, setHud] = React.useState<{ zone?: string; follow?: string | null; avRoom?: string | null }>({});

  useEffect(() => {
    if (!containerRef.current) return;
    const game = createPhaserGame(containerRef.current);

    // Colyseus World
    (async () => {
      const room = await joinWorld(import.meta.env.VITE_API_BASE);
      colyseusRef.current = room;
      localPosRef.current.id = room.sessionId;
      // Lokale Bewegung → Server
      gameBridge.onLocalMove = (p) => {
        localPosRef.current.x = p.x;
        localPosRef.current.y = p.y;
        // Zonen prüfen
        zoneRef.current?.update({ x: p.x, y: p.y });
        // Follow-Update
        if (followRef.current) {
          const f = followRef.current.update(
            { x: p.x, y: p.y },
            remotesRef.current
          );
          if (f.following) {
            // Szene Richtung Ziel bewegen lassen
            gameBridge.setDesiredPosition({ x: f.x, y: f.y });
          } else {
            gameBridge.setDesiredPosition(null);
          }
        }
        room.send('move', p);
      };
      // Remote-Players spiegeln
      room.onStateChange((state: any) => {
        const players: Record<string, { x: number; y: number; direction: any }> = {};
        state.players?.forEach?.((value: any, key: string) => {
          players[key] = { x: value.x, y: value.y, direction: value.direction };
        });
        remotesRef.current = Object.fromEntries(
          Object.entries(players).filter(([id]) => id !== localPosRef.current.id).map(([id, p]) => [id, { x: p.x, y: p.y }])
        );
        // Bubble recompute
        if (bubbleRef.current) {
          const others = Object.entries(remotesRef.current).map(([id, p]) => ({ id, x: p.x, y: p.y }));
          bubbleRef.current.update(localPosRef.current, others);
        }
        gameBridge.syncRemotePlayers(players);
      });
    })();

    // LiveKit Basis (Haupt-Raum) erst nach User-Geste verbinden (Autoplay-Policy)
    const identity = `${Math.random().toString(36).slice(2)}`;
    const connectLivekit = async () => {
      try {
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
    };
    const firstInteract = () => {
      window.removeEventListener('pointerdown', firstInteract);
      window.removeEventListener('keydown', firstInteract);
      connectLivekit();
    };
    window.addEventListener('pointerdown', firstInteract);
    window.addEventListener('keydown', firstInteract);

    // Bubble & Zonen Manager verdrahten (Stub: keine echten Zonen eingetragen)
    bubbleRef.current = new BubbleManager(64, avRef.current!);
    followRef.current = new FollowManager(96);
    zoneRef.current = new ZoneManager([], avRef.current!);

    // Zonen laden
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE}/zones`);
        const zones = await res.json();
        if (Array.isArray(zones) && zones.length > 0) {
          const polys = zones.map((z: any) => ({ name: z.name, points: z.polygon?.points ?? z.polygon ?? [] }));
          zoneRef.current = new ZoneManager(polys, avRef.current!);
          // draw overlay
          gameBridge.setZoneOverlay(polys);
        } else {
          // Fallback statische Zonen
          const fallback = [
            { name: 'meeting-a', points: [{ x: 120, y: 120 }, { x: 200, y: 120 }, { x: 200, y: 180 }, { x: 120, y: 180 }] },
            { name: 'meeting-b', points: [{ x: 240, y: 80 }, { x: 300, y: 80 }, { x: 300, y: 140 }, { x: 240, y: 140 }] },
          ];
          zoneRef.current = new ZoneManager(fallback, avRef.current!);
          gameBridge.setZoneOverlay(fallback);
        }
      } catch {
        // ignore; keep empty zones
      }
    })();

    // Follow Toggle (Taste F): auf nächsten Spieler gehen/abbrechen
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'f') {
        const ids = Object.keys(remotesRef.current);
        if (followRef.current && ids.length > 0) {
          if (followRef.current['targetId']) {
            followRef.current.stop();
            gameBridge.setDesiredPosition(null);
          } else {
            // Nächsten Spieler als Ziel wählen
            const nearest = ids
              .map(id => ({ id, dx: remotesRef.current[id].x - localPosRef.current.x, dy: remotesRef.current[id].y - localPosRef.current.y }))
              .sort((a, b) => (a.dx * a.dx + a.dy * a.dy) - (b.dx * b.dx + b.dy * b.dy))[0]?.id;
            if (nearest) followRef.current.startFollowing(nearest);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);

    // HUD updater
    const hudTimer = setInterval(() => {
      setHud({
        zone: zoneRef.current?.getCurrent?.(),
        follow: followRef.current?.getTarget?.() ?? null,
        avRoom: avRef.current?.activeRoom ?? null,
      });
    }, 300);

    return () => {
      destroyPhaserGame(game);
      colyseusRef.current?.leave?.();
      livekitRef.current?.disconnect?.();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', firstInteract);
      window.removeEventListener('keydown', firstInteract);
      clearInterval(hudTimer);
    };
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#1b1b1b', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: 8, borderRadius: 6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>
        <div>Zone: {hud.zone ?? '-'}</div>
        <div>AV: {hud.avRoom ?? 'lobby'}</div>
        <div>Following: {hud.follow ?? 'no'}</div>
        <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
          <button onClick={() => {
            const ids = Object.keys(remotesRef.current);
            if (!followRef.current) return;
            if (followRef.current.getTarget?.()) {
              followRef.current.stop();
              gameBridge.setDesiredPosition(null);
            } else if (ids.length > 0) {
              const nearest = ids
                .map(id => ({ id, dx: remotesRef.current[id].x - localPosRef.current.x, dy: remotesRef.current[id].y - localPosRef.current.y }))
                .sort((a, b) => (a.dx * a.dx + a.dy * a.dy) - (b.dx * b.dx + b.dy * b.dy))[0]?.id;
              if (nearest) followRef.current.startFollowing(nearest);
            }
          }}>Toggle Follow (F)</button>
          <button onClick={() => avRef.current?.startScreenshare()}>Start Screenshare</button>
          <button onClick={() => avRef.current?.stopScreenshare()}>Stop Screenshare</button>
        </div>
      </div>
    </div>
  );
}
