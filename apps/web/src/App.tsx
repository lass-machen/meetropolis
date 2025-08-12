import React, { useEffect, useRef } from 'react';
import { createPhaserGame, destroyPhaserGame } from './game/phaserGame';
import { gameBridge } from './game/bridge';
import { joinWorld } from './lib/colyseus';
import { AVManager } from './av/avManager';
import { BubbleManager } from './game/bubbleManager';
import { FollowManager } from './game/followManager';
import { ZoneManager } from './game/zoneManager';

// Simple Inline-Icons
function MicIcon(props: { on?: boolean }) {
  const color = props.on ? '#10b981' : '#e5e7eb';
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 14a4 4 0 0 0 4-4V6a4 4 0 1 0-8 0v4a4 4 0 0 0 4 4Z" stroke={color} strokeWidth="1.8" />
      <path d="M19 10a7 7 0 1 1-14 0" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 17v4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function CamIcon(props: { on?: boolean }) {
  const color = props.on ? '#10b981' : '#e5e7eb';
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="7" width="12" height="10" rx="2" stroke={color} strokeWidth="1.8" />
      <path d="M21 8v8l-5-3.2V11.2L21 8Z" fill={color} />
    </svg>
  );
}
function ScreenIcon(props: { on?: boolean }) {
  const color = props.on ? '#10b981' : '#e5e7eb';
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="4" width="18" height="12" rx="2" stroke={color} strokeWidth="1.8" />
      <rect x="8" y="18" width="8" height="2" rx="1" fill={color} />
    </svg>
  );
}

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
  const [uiParticipants, setUiParticipants] = React.useState<{ sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean }[]>([]);
  // Auth state
  const [authChecked, setAuthChecked] = React.useState(false);
  const [me, setMe] = React.useState<{ id: string; email: string; name?: string } | null>(null);
  // view/state werden in AuthScreen verwaltet
  // Grid Overlay expand/collapse
  const [gridExpanded, setGridExpanded] = React.useState(false);

  const apiBase = import.meta.env.VITE_API_BASE as string;

  async function fetchMe() {
    try {
      const res = await fetch(`${apiBase}/auth/me`, { credentials: 'include' });
      if (!res.ok) {
        setMe(null);
      } else {
        const u = await res.json();
        setMe(u);
      }
    } catch {
      setMe(null);
    } finally {
      setAuthChecked(true);
    }
  }

  useEffect(() => {
    fetchMe();
  }, []);

  const buildParticipantList = React.useCallback(() => {
    const room: any = avRef.current?.room as any;
    if (!room || !room.localParticipant || !room.participants) return;
    const activeSet = new Set<string>((room.activeSpeakers || []).map((p: any) => p.sid));
    const list: { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean }[] = [];
    const pushP = (p: any) => {
      if (!p || !p.trackPublications) return;
      const publications = Array.from((p.trackPublications?.values?.() || []) as any);
      const hasV = publications.some((pub: any) => (pub?.source || pub?.track?.source) === 'camera' && !!pub?.track);
      const hasMic = publications.some((pub: any) => (pub?.source || pub?.track?.source) === 'microphone' && !!pub?.track);
      const identity = p.identity || 'User';
      list.push({ sid: p.sid, identity, hasVideo: hasV, hasMic, isSpeaking: activeSet.has(p.sid) });
    };
    pushP(room.localParticipant);
    for (const rp of Array.from(room.participants.values?.() || [])) pushP(rp);
    setUiParticipants(list);
  }, []);

  useEffect(() => {
    if (!authChecked || !me) return;
    if (!containerRef.current) return;
    const game = createPhaserGame(containerRef.current);

    // Colyseus World
    (async () => {
      const room = await joinWorld(import.meta.env.VITE_API_BASE);
      colyseusRef.current = room;
      localPosRef.current.id = room.sessionId;
      gameBridge.onLocalMove = (p) => {
        localPosRef.current.x = p.x;
        localPosRef.current.y = p.y;
        zoneRef.current?.update({ x: p.x, y: p.y });
        if (followRef.current) {
          const f = followRef.current.update(
            { x: p.x, y: p.y },
            remotesRef.current
          );
          if (f.following) {
            gameBridge.setDesiredPosition({ x: f.x, y: f.y });
          } else {
            gameBridge.setDesiredPosition(null);
          }
        }
        colyseusRef.current?.send?.('move', p);
      };
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
        if (bubbleRef.current) {
          const remoteEntries = Object.entries(remotesRef.current) as [string, { x: number; y: number }][];
          const others = remoteEntries.map(([id, p]) => ({ id, x: p.x, y: p.y }));
          bubbleRef.current.update(localPosRef.current, others);
        }
        gameBridge.syncRemotePlayers(players);
      });
    })();

    // LiveKit nach User-Geste verbinden
    const identity = me.id;
    const connectLivekit = async () => {
      try {
        avRef.current = new AVManager({ baseUrl: apiBase, identity, useVideo: import.meta.env.VITE_FEATURE_VOICE_ONLY !== 'true' });
        bubbleRef.current?.setAV(avRef.current);
        zoneRef.current?.setAV(avRef.current);
        await avRef.current.switchTo('lobby');
        const list = await avRef.current.listDevices();
        setDevices({
          mics: list.microphones.map(d => ({ id: d.deviceId, label: d.label })),
          cams: list.cameras.map(d => ({ id: d.deviceId, label: d.label })),
        });
        // erst listen, dann sicher bauen
        setTimeout(buildParticipantList, 50);
      } catch (e) {
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

    bubbleRef.current = new BubbleManager(64, null);
    followRef.current = new FollowManager(96);
    zoneRef.current = new ZoneManager([], null);

    const hudTimer = setInterval(() => {
      const z = zoneRef.current?.getCurrent?.();
      const next: { zone?: string; follow?: string | null; avRoom?: string | null } = {
        follow: followRef.current?.getTarget?.() ?? null,
        avRoom: avRef.current?.activeRoom ?? null,
      };
      if (typeof z === 'string') next.zone = z;
      setHud(next);

      const room: any = avRef.current?.room as any;
      if (room && room.localParticipant && room.localParticipant.trackPublications) {
        const pubs = Array.from(room.localParticipant.trackPublications?.values?.() || []);
        const hasMic = pubs.some((pub: any) => (pub.source || pub.track?.source) === 'microphone');
        const hasCam = pubs.some((pub: any) => (pub.source || pub.track?.source) === 'camera');
        const hasShare = pubs.some((pub: any) => ['screen_share','screen_share_audio'].includes(pub.source || pub.track?.source));
        setAvState(s => (s.mic === hasMic && s.cam === hasCam && s.share === hasShare) ? s : { ...s, mic: hasMic, cam: hasCam, share: hasShare });
        buildParticipantList();
      }
    }, 250);

    return () => {
      destroyPhaserGame(game);
      colyseusRef.current?.leave?.();
      avRef.current?.leave?.();
      window.removeEventListener('keydown', firstInteract);
      clearInterval(hudTimer);
    };
  }, [authChecked, me, apiBase, buildParticipantList]);

  if (!authChecked) {
    return <div style={{display:'grid',placeItems:'center',height:'100vh',color:'#fff'}}>Lade…</div>;
  }
  if (!me) {
    return <AuthScreen baseUrl={apiBase} onDone={async () => { await fetchMe(); }} />;
  }

  const participantsToRender = uiParticipants.length > 0
    ? uiParticipants
    : [{ sid: 'local', identity: me.name || me.email, hasVideo: false, hasMic: false, isSpeaking: false }];

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0f1115', position: 'relative' }}>
      {/* Participants Grid Overlay */}
      <div style={{ position: 'absolute', top: gridExpanded ? 0 : 10, left: '50%', transform: 'translateX(-50%)', zIndex: 20, width: gridExpanded ? '96vw' : '90vw', maxWidth: gridExpanded ? undefined : 1200 }}>
        <div style={{ position: 'relative', background: gridExpanded ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 12, backdropFilter: 'blur(6px)' }}>
          <button onClick={() => setGridExpanded(e => !e)} style={{ position: 'absolute', top: 10, right: 10, padding: '6px 10px', fontSize: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer' }}>
            {gridExpanded ? 'Verkleinern' : 'Vergrößern'}
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {participantsToRender.map(p => (
              <ParticipantCard key={p.sid} part={p} roomGetter={() => avRef.current?.room} />
            ))}
          </div>
        </div>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* HUD (links oben klein) */}
      <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,0.45)', color: '#fff', padding: 8, borderRadius: 8, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div>Zone: {hud.zone ?? '-'}</div>
        <div>AV: {hud.avRoom ?? 'lobby'}</div>
        <div>Following: {hud.follow ?? 'no'}</div>
      </div>

      {/* Bottom Control Bar */}
      <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'rgba(17,17,20,0.75)', color: '#fff', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)', backdropFilter: 'blur(8px)' }}>
        <button style={btnStyle(avState.mic)} onClick={async () => {
          const enabled = !avState.mic;
          await avRef.current?.setMicrophoneEnabled(enabled);
          setAvState(s => ({ ...s, mic: enabled }));
        }}>
          <MicIcon on={avState.mic} />
          <span style={btnLabelStyle}>Mic {avState.mic ? 'aus' : 'an'}</span>
        </button>

        <select style={selectStyle} disabled={!devices.mics.length} onChange={async (e) => {
          await avRef.current?.useMicrophoneDevice(e.target.value);
        }} defaultValue="">
          <option value="" disabled>Mic wählen…</option>
          {devices.mics.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>

        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)' }} />

        <button style={btnStyle(avState.cam)} onClick={async () => {
          const enabled = !avState.cam;
          await avRef.current?.setCameraEnabled(enabled);
          setAvState(s => ({ ...s, cam: enabled }));
        }}>
          <CamIcon on={avState.cam} />
          <span style={btnLabelStyle}>{avState.cam ? 'Kamera aus' : 'Kamera an'}</span>
        </button>

        <select style={selectStyle} disabled={!devices.cams.length} onChange={async (e) => {
          await avRef.current?.useCameraDevice(e.target.value);
        }} defaultValue="">
          <option value="" disabled>Kamera wählen…</option>
          {devices.cams.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>

        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)' }} />

        <button style={btnStyle(avState.share)} onClick={async () => {
          if (!avState.share) {
            await avRef.current?.startScreenshare();
          } else {
            await avRef.current?.stopScreenshare();
          }
          setAvState(s => ({ ...s, share: !s.share }));
        }}>
          <ScreenIcon on={avState.share} />
          <span style={btnLabelStyle}>{avState.share ? 'Screenshare stoppen' : 'Screenshare starten'}</span>
        </button>
      </div>
    </div>
  );
}

// Styles
const btnStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 12px', borderRadius: 10,
  background: active ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.06)',
  border: `1px solid ${active ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.08)'}`,
  color: '#fff', cursor: 'pointer',
  outline: 'none',
});
const btnLabelStyle: React.CSSProperties = { fontSize: 12, letterSpacing: 0.2 }; 
const selectStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#fff',
  borderRadius: 8,
  padding: '6px 8px',
  fontSize: 12,
};

// Teilnehmer-Card-Komponente (verschönert)
function ParticipantCard(props: { part: { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean }, roomGetter: () => any | undefined }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const { part, roomGetter } = props;
  const [isVideoRendering, setIsVideoRendering] = React.useState(false);

  useEffect(() => {
    const room: any = roomGetter();
    const el = videoRef.current;
    if (!room || !el || !room.localParticipant) return;
    const isLocal = room.localParticipant?.sid === part.sid;
    const p: any = isLocal ? room.localParticipant : room.participants?.get?.(part.sid);
    if (!p || !p.trackPublications) return;
    const pubs: any[] = Array.from(p.trackPublications?.values?.() || []);
    const camPub = pubs.find(pub => (pub?.source || pub?.track?.source) === 'camera');
    const track = camPub?.track;
    let cleanup: (() => void) | undefined;

    const onLoaded = () => {
      try {
        // Wenn Frames gerendert werden, sollte readyState > 2 sein
        if (el.readyState >= 2) setIsVideoRendering(true);
      } catch {}
    };
    const onPlaying = () => setIsVideoRendering(true);
    const onEmptied = () => setIsVideoRendering(false);
    el.addEventListener('loadeddata', onLoaded);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('emptied', onEmptied);

    if (track) {
      try {
        track.attach(el);
        cleanup = () => { try { track.detach(el); } catch {} };
      } catch {}
    }
    return () => {
      el.removeEventListener('loadeddata', onLoaded);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('emptied', onEmptied);
      cleanup?.();
    };
  }, [part.sid, part.hasVideo, roomGetter]);

  const borderColor = part.isSpeaking ? '#22d3ee' : 'rgba(255,255,255,0.12)';
  const glow = part.isSpeaking ? '0 0 0 2px rgba(34,211,238,0.35), 0 10px 24px rgba(34,211,238,0.25)' : '0 10px 24px rgba(0,0,0,0.35)';
  const gradient = 'linear-gradient(145deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))';

  return (
    <div style={{ width: '100%', aspectRatio: '16 / 9', position: 'relative', borderRadius: 12, overflow: 'hidden', background: gradient, border: `1px solid ${borderColor}`, boxShadow: glow }}>
      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', background: 'rgba(0,0,0,0.3)' }} />
      {!(part.hasVideo || isVideoRendering) && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#e5e7eb', fontWeight: 600, fontSize: 16 }}>
          {part.identity}
        </div>
      )}
      {/* Badges */}
      <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 6 }}>
        <div title={part.hasMic ? 'Mikro an' : 'Mikro aus'} style={{ padding: '2px 6px', fontSize: 11, borderRadius: 999, background: part.hasMic ? 'rgba(16,185,129,0.25)' : 'rgba(244,63,94,0.25)', border: `1px solid ${part.hasMic ? 'rgba(16,185,129,0.5)' : 'rgba(244,63,94,0.5)'}`, color: '#fff' }}>Mic</div>
        <div title={part.hasVideo ? 'Kamera an' : 'Kamera aus'} style={{ padding: '2px 6px', fontSize: 11, borderRadius: 999, background: part.hasVideo ? 'rgba(16,185,129,0.25)' : 'rgba(244,63,94,0.25)', border: `1px solid ${part.hasVideo ? 'rgba(16,185,129,0.5)' : 'rgba(244,63,94,0.5)'}`, color: '#fff' }}>Cam</div>
      </div>
      <div style={{ position: 'absolute', bottom: 8, left: 10, right: 10, fontSize: 13, color: '#f3f4f6', textShadow: '0 1px 2px rgba(0,0,0,0.6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {part.identity}
      </div>
    </div>
  );
}

function AuthScreen(props: { baseUrl: string; onDone: () => void }) {
  const { baseUrl, onDone } = props;
  const [view, setView] = React.useState<'login'|'register'|'forgot'|'reset'>('login');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [name, setName] = React.useState('');
  const [invite, setInvite] = React.useState('');
  const [token, setToken] = React.useState('');
  const [msg, setMsg] = React.useState<string | null>(null);

  async function post(path: string, body: any) {
    const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json())?.error || 'Fehler');
    return await res.json().catch(() => ({}));
  }

  const commonStyle: React.CSSProperties = { display: 'grid', gap: 10, width: 320, padding: 16, background: 'rgba(17,17,20,0.8)', color: '#fff', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0f1115', display: 'grid', placeItems: 'center' }}>
      <div style={commonStyle}>
        {view === 'login' && (
          <>
            <h3 style={{ margin: 0 }}>Login</h3>
            <input placeholder="E-Mail" value={email} onChange={e=>setEmail(e.target.value)} />
            <input placeholder="Passwort" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
            <button onClick={async()=>{ try{ await post('/auth/login',{email,password}); onDone(); } catch(e:any){ setMsg(e.message); } }}>Einloggen</button>
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <a style={{ cursor:'pointer' }} onClick={()=>setView('forgot')}>Passwort vergessen?</a>
              <a style={{ cursor:'pointer' }} onClick={()=>setView('register')}>Einladung einlösen</a>
            </div>
          </>
        )}
        {view === 'register' && (
          <>
            <h3 style={{ margin: 0 }}>Registrieren (Einladung nötig)</h3>
            <input placeholder="Einladungscode" value={invite} onChange={e=>setInvite(e.target.value)} />
            <input placeholder="Name (optional)" value={name} onChange={e=>setName(e.target.value)} />
            <input placeholder="E-Mail" value={email} onChange={e=>setEmail(e.target.value)} />
            <input placeholder="Passwort" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
            <button onClick={async()=>{ try{ await post('/auth/register',{code:invite,name,email,password}); onDone(); } catch(e:any){ setMsg(e.message); } }}>Registrieren</button>
            <a style={{ cursor:'pointer' }} onClick={()=>setView('login')}>Zurück zum Login</a>
          </>
        )}
        {view === 'forgot' && (
          <>
            <h3 style={{ margin: 0 }}>Passwort vergessen</h3>
            <input placeholder="E-Mail" value={email} onChange={e=>setEmail(e.target.value)} />
            <button onClick={async()=>{ try{ const r=await post('/auth/forgot',{email}); setMsg(`Reset-Token (Debug): ${r.token||'per Mail'}`); setView('reset'); } catch(e:any){ setMsg(e.message); } }}>Zurücksetzen anfordern</button>
            <a style={{ cursor:'pointer' }} onClick={()=>setView('login')}>Zurück zum Login</a>
          </>
        )}
        {view === 'reset' && (
          <>
            <h3 style={{ margin: 0 }}>Passwort zurücksetzen</h3>
            <input placeholder="Reset-Token" value={token} onChange={e=>setToken(e.target.value)} />
            <input placeholder="Neues Passwort" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
            <button onClick={async()=>{ try{ await post('/auth/reset',{token,password}); setView('login'); setMsg('Passwort aktualisiert'); } catch(e:any){ setMsg(e.message); } }}>Passwort speichern</button>
            <a style={{ cursor:'pointer' }} onClick={()=>setView('login')}>Zurück zum Login</a>
          </>
        )}
        {msg && <div style={{ color:'#fca5a5' }}>{msg}</div>}
      </div>
    </div>
  );
}
