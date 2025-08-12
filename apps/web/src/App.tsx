import React, { useEffect, useRef } from 'react';
import { createPhaserGame, destroyPhaserGame } from './game/phaserGame';
import { gameBridge } from './game/bridge';
import { joinWorld } from './lib/colyseus';
import { AVManager } from './av/avManager';
import { BubbleManager } from './game/bubbleManager';
import { FollowManager } from './game/followManager';
import { ZoneManager } from './game/zoneManager';

export function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const colyseusRef = useRef<any>(null);
  const avRef = useRef<AVManager | null>(null);
  const bubbleRef = useRef<BubbleManager | null>(null);
  const zoneRef = useRef<ZoneManager | null>(null);
  const followRef = useRef<import('./game/followManager').FollowManager | null>(null);
  const localPosRef = useRef<{ id: string; x: number; y: number }>({ id: '', x: 0, y: 0 });
  const remotesRef = useRef<Record<string, { x: number; y: number }>>({});
  const [hud, setHud] = React.useState<{ zone?: string; follow?: string | null; avRoom?: string | null }>({});
  const [devices, setDevices] = React.useState<{ mics: { id: string; label: string }[]; cams: { id: string; label: string }[] }>({ mics: [], cams: [] });
  const [avState, setAvState] = React.useState<{ mic: boolean; cam: boolean; share: boolean }>({ mic: false, cam: false, share: false });

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
        const playerEntries = Object.entries(players) as [string, { x: number; y: number; direction: any }][];
        remotesRef.current = Object.fromEntries(
          playerEntries
            .filter(([id]) => id !== localPosRef.current.id)
            .map(([id, p]) => [id, { x: p.x, y: p.y }])
        );
        // Bubble recompute
        if (bubbleRef.current) {
          const remoteEntries = Object.entries(remotesRef.current) as [string, { x: number; y: number }][];
          const others = remoteEntries.map(([id, p]) => ({ id, x: p.x, y: p.y }));
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
        // AV in Manager injizieren
        bubbleRef.current?.setAV(avRef.current);
        zoneRef.current?.setAV(avRef.current);
        // In Lobby wechseln
        await avRef.current.switchTo('lobby');
        // Geräte listen
        const list = await avRef.current.listDevices();
        setDevices({
          mics: list.microphones.map(d => ({ id: d.deviceId, label: d.label })),
          cams: list.cameras.map(d => ({ id: d.deviceId, label: d.label })),
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
    bubbleRef.current = new BubbleManager(64, null);
    followRef.current = new FollowManager(96);
    zoneRef.current = new ZoneManager([], null);

    // HUD updater
    const hudTimer = setInterval(() => {
      const z = zoneRef.current?.getCurrent?.();
      const next: { zone?: string; follow?: string | null; avRoom?: string | null } = {
        follow: followRef.current?.getTarget?.() ?? null,
        avRoom: avRef.current?.activeRoom ?? null,
      };
      if (typeof z === 'string') next.zone = z;
      setHud(next);

      // AV-Indikator aus realem Track-Status ableiten
      const room = avRef.current?.room;
      if (room) {
        const pubs = Array.from(room.localParticipant.trackPublications.values());
        const hasMic = pubs.some(pub => {
          const src = (pub as any).source || (pub.track as any)?.source;
          return src === 'microphone';
        });
        const hasCam = pubs.some(pub => {
          const src = (pub as any).source || (pub.track as any)?.source;
          return src === 'camera';
        });
        const hasShare = pubs.some(pub => {
          const src = (pub as any).source || (pub.track as any)?.source;
          return src === 'screen_share' || src === 'screen_share_audio';
        });
        setAvState(s => {
          if (s.mic === hasMic && s.cam === hasCam && s.share === hasShare) return s;
          return { ...s, mic: hasMic, cam: hasCam, share: hasShare };
        });
      }
    }, 300);

    return () => {
      destroyPhaserGame(game);
      colyseusRef.current?.leave?.();
      avRef.current?.leave?.();
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
      </div>
      {/* Bottom Menu Bar */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', gap: 12, padding: 10, background: 'rgba(0,0,0,0.7)', color: '#fff' }}>
        <button onClick={async () => {
          const enabled = !avState.mic;
          await avRef.current?.setMicrophoneEnabled(enabled);
          setAvState(s => ({ ...s, mic: enabled }));
        }}>{avState.mic ? 'Mic aus' : 'Mic an'}</button>
        <select disabled={!devices.mics.length} onChange={async (e) => {
          await avRef.current?.useMicrophoneDevice(e.target.value);
        }} defaultValue="">
          <option value="" disabled>Mic wählen…</option>
          {devices.mics.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>

        <button onClick={async () => {
          const enabled = !avState.cam;
          await avRef.current?.setCameraEnabled(enabled);
          setAvState(s => ({ ...s, cam: enabled }));
        }}>{avState.cam ? 'Kamera aus' : 'Kamera an'}</button>
        <select disabled={!devices.cams.length} onChange={async (e) => {
          await avRef.current?.useCameraDevice(e.target.value);
        }} defaultValue="">
          <option value="" disabled>Kamera wählen…</option>
          {devices.cams.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>

        <button onClick={async () => {
          if (!avState.share) {
            await avRef.current?.startScreenshare();
          } else {
            await avRef.current?.stopScreenshare();
          }
          setAvState(s => ({ ...s, share: !s.share }));
        }}>{avState.share ? 'Screenshare stoppen' : 'Screenshare starten'}</button>
      </div>
    </div>
  );
}
