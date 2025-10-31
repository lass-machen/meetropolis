import React from 'react';
import { FAIcon } from '../FAIcon';
import { useTranslation } from 'react-i18next';
import { Button } from '../system/Button';

export function ParticipantCard(props: { part: { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera'|'screen'; volume?: number }, roomGetter: () => any | undefined, compact?: boolean, full?: boolean, zoom?: number }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const { part, roomGetter, compact, full, zoom = 1 } = props;
  const [isVideoRendering, setIsVideoRendering] = React.useState(false);
  const [isLocal, setIsLocal] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const { t } = useTranslation('common');

  React.useEffect(() => {
    const room: any = roomGetter();
    const el = videoRef.current;
    if (!room || !room.localParticipant || !el) return;
    let baseSid = (part.sid || '').split(':')[0];
    const isLocalNow = room.localParticipant?.sid === baseSid;
    setIsLocal(isLocalNow);
    let p: any = isLocalNow ? room.localParticipant : (room.participants?.get?.(baseSid) || room.remoteParticipants?.get?.(baseSid));
    
    if (!p && !isLocalNow) {
      const allParticipants = Array.from(room.remoteParticipants?.values() || []);
      const searchIdentity = part.media === 'screen' && part.identity.endsWith(' – Bildschirm') 
        ? part.identity.slice(0, -14)
        : part.identity;
      p = allParticipants.find((participant: any) => {
        const pName = participant.name || participant.identity;
        return pName === searchIdentity;
      });
      if (!p) {
        p = allParticipants.find((participant: any) => participant.identity === searchIdentity);
      }
      if (p) {
        baseSid = p.sid;
      } else if (part.media === 'screen') {
        p = allParticipants.find((participant: any) => {
          const pName = participant.name || participant.identity;
          return part.identity.startsWith(pName + ' –');
        });
        if (p) {
          baseSid = p.sid;
        }
      }
    }
    
    if (!p || !p.trackPublications) {
      return;
    }
    const pubs: any[] = Array.from(p.trackPublications?.values?.() || []);
    const track = (part.media === 'screen'
      ? pubs.find(pub => (pub?.source || pub?.track?.source) === 'screen_share')?.track
      : pubs.find(pub => (pub?.source || pub?.track?.source) === 'camera')?.track);
    let cleanup: (() => void) | undefined;
    let pollTimer: any;

    const onLoaded = () => {
      try {
        if (el.readyState >= 2) setIsVideoRendering(true);
      } catch {}
    };
    const onPlaying = () => setIsVideoRendering(true);
    const onEmptied = () => setIsVideoRendering(false);
    el.addEventListener('loadeddata', onLoaded);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('emptied', onEmptied);

    if (track && el) {
      try {
        el.muted = true;
        track.attach(el);
        cleanup = () => { try { track.detach(el); } catch {} };
      } catch {}
    }

    const tryAttach = () => {
      try {
        let currentP = p;
        if (!currentP && part.media === 'screen' && !isLocalNow) {
          const allParticipants = Array.from(room.remoteParticipants?.values() || []);
          const searchIdentity = part.identity.endsWith(' – Bildschirm') 
            ? part.identity.slice(0, -14) 
            : part.identity;
          currentP = allParticipants.find((participant: any) => {
            const pName = participant.name || participant.identity;
            return pName === searchIdentity || part.identity.startsWith(pName + ' –');
          });
          if (!currentP) {
            currentP = allParticipants.find((participant: any) => 
              participant.identity === searchIdentity ||
              part.identity.startsWith(participant.identity + ' –')
            );
          }
          if (currentP && currentP !== p) {
            p = currentP;
            baseSid = currentP.sid;
          }
        }
        if (!currentP) return;
        const pubsNow: any[] = Array.from(currentP.trackPublications?.values?.() || []);
        const cam = pubsNow.find((pub: any) => {
          const src = (pub?.source || pub?.track?.source);
          if (part.media === 'screen') return src === 'screen_share';
          return src === 'camera';
        });
        const trackObj = (cam as any)?.track;
        if (trackObj && el && !el.srcObject) {
          try { 
            el.muted = true;
            trackObj.attach(el); 
            setIsVideoRendering(false); 
            clearInterval(pollTimer);
          } catch {}
        }
      } catch {}
    };
    pollTimer = setInterval(tryAttach, 400);
    setTimeout(() => { try { clearInterval(pollTimer); } catch {} }, 6000);

    const onTrackSubscribed = (t: any, _publication: any, participant: any) => {
      try {
        const src = (t?.source || t?.mediaStreamTrack?.kind) as string | undefined;
        const isDesired = part.media === 'screen' ? (src === 'screen_share') : (src === 'camera');
        if (participant?.sid === baseSid && isDesired && el) {
          try { 
            el.muted = true;
            t.attach(el); 
            setIsVideoRendering(false);
          } catch {}
        }
      } catch {}
    };
    const onTrackUnsubscribed = (_t: any, _publication: any, _participant: any) => {
      try {} catch {}
    };
    const onTrackPublished = (_t: any, _publication: any, _participant: any) => {
      try {} catch {}
    };
    (async () => {
      try {
        const mod = await import('livekit-client');
        const RoomEvent = (mod as any).RoomEvent;
        if (RoomEvent) {
          room.on?.(RoomEvent.TrackSubscribed, onTrackSubscribed);
          room.on?.(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
          room.on?.(RoomEvent.TrackPublished, onTrackPublished);
          room.on?.(RoomEvent.LocalTrackPublished, (publication: any) => {
            try {
              const src = (publication?.source || publication?.track?.source) as string | undefined;
              const wantCamera = (part.media === 'camera' && src === 'camera');
              const wantScreen = (part.media === 'screen' && src === 'screen_share');
              if (isLocalNow && (wantCamera || wantScreen) && publication?.track && el) {
                try { el.muted = true; publication.track.attach(el); setIsVideoRendering(false); } catch {}
              }
            } catch {}
          });
        } else {
          room.on?.('trackSubscribed', onTrackSubscribed);
          room.on?.('trackUnsubscribed', onTrackUnsubscribed);
          room.on?.('trackPublished', onTrackPublished);
          room.on?.('localTrackPublished', () => { try { if (isLocalNow && el) setTimeout(()=>setIsVideoRendering(false),0); } catch {} });
        }
      } catch {}
    })();
    return () => {
      const node = videoRef.current;
      try { node?.removeEventListener('loadeddata', onLoaded); } catch {}
      try { node?.removeEventListener('playing', onPlaying); } catch {}
      try { node?.removeEventListener('emptied', onEmptied); } catch {}
      cleanup?.();
      try { clearInterval(pollTimer); } catch {}
      try {
        const offAll = async () => {
          try {
            const mod = await import('livekit-client');
            const RoomEvent = (mod as any).RoomEvent;
            if (RoomEvent) {
              room.off?.(RoomEvent.TrackSubscribed, onTrackSubscribed);
              room.off?.(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
              room.off?.(RoomEvent.TrackPublished, onTrackPublished);
              room.off?.(RoomEvent.LocalTrackPublished, () => {});
            } else {
              room.off?.('trackSubscribed', onTrackSubscribed);
              room.off?.('trackUnsubscribed', onTrackUnsubscribed);
              room.off?.('trackPublished', onTrackPublished);
              room.off?.('localTrackPublished', () => {});
            }
          } catch {}
        };
        offAll();
      } catch {}
    };
  }, [part.sid, part.hasVideo, roomGetter]);

  const volume = part.volume ?? 1;
  const opacity = isLocal ? 1 : (0.4 + (volume * 0.6));
  
  const borderColor = part.isSpeaking ? '#22d3ee' : 'var(--border)';
  const glow = part.isSpeaking ? '0 0 0 2px rgba(34,211,238,0.35), var(--shadow)' : 'var(--shadow)';
  const isScreen = part.media === 'screen';
  const aspect = full ? undefined : (isScreen ? '16 / 9' : '16 / 9');
  const targetSize = full ? undefined : (compact ? '100%' : '36vh');
  const minW = full ? undefined : (compact ? 260 : 420);
  const disabled = !isLocal && (volume <= 0.1);

  const handleForceMute = async () => {
    try {
      const target = (part.identity || '').replace(/\s+–\s*Bildschirm$/, '');
      await fetch(`/controls/for/${encodeURIComponent(target)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mic: false })
      });
    } catch {}
  };

  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{
      width: full ? 'min(calc(100vw - 64px), 1920px)' : `min(${targetSize}, 100%)`,
      minWidth: minW as any,
      maxHeight: full ? 'calc(100vh - 64px)' : (targetSize as any),
      aspectRatio: aspect as any,
      position: 'relative', borderRadius: 14, overflow: 'hidden', background: 'var(--uc-glass)', border: `1px solid ${borderColor}`, boxShadow: glow,
      opacity: opacity,
      transition: 'opacity 0.3s ease-in-out',
      pointerEvents: 'auto',
      filter: disabled ? 'grayscale(90%) brightness(0.8)' : undefined,
      height: full ? 'auto' : 'min(140px, 30vh)'
    }}>
      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: full ? 'auto' : '100%', maxHeight: full ? 'calc(100vh - 64px)' : undefined, objectFit: isScreen ? 'contain' : (full ? 'contain' : 'cover'), background: 'transparent', transform: (isLocal && part.media==='camera') ? `scaleX(-1) scale(${zoom})` : `scale(${zoom})`, transformOrigin: 'center center' }} />
      {!(part.hasVideo || isVideoRendering) && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--fg)', fontWeight: 600, fontSize: 14 }}>
          {part.identity}
        </div>
      )}
      <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--bg-btn-bg, var(--glass))', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: 12, color: 'var(--fg)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{part.identity}</div>
      </div>
      <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 8 }}>
        <div title={part.hasMic ? 'Mikro an' : 'Mikro aus'} style={{ display:   'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 999, background: part.hasMic ? 'rgba(16,185,129,0.25)' : 'rgba(244,63,94,0.25)', border: `1px solid ${part.hasMic ? 'rgba(16,185,129,0.5)' : 'rgba(244,63,94,0.5)'}` }}>
          <FAIcon size="sm" name={part.hasMic ? 'microphone' : 'microphone-slash'} variant="solid" ariaLabel={part.hasMic ? 'Mikro an' : 'Mikro aus'} />
        </div>
        <div title={part.hasVideo ? 'Kamera an' : 'Kamera aus'} style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 999, background: (part.hasVideo || isVideoRendering) ? 'rgba(16,185,129,0.25)' : 'rgba(244,63,94,0.25)', border: `1px solid ${(part.hasVideo || isVideoRendering) ? 'rgba(16,185,129,0.5)' : 'rgba(244,63,94,0.5)'}` }}>
          <FAIcon size="sm" name={(part.hasVideo || isVideoRendering) ? 'video' : 'video-slash'} variant="solid" ariaLabel={(part.hasVideo || isVideoRendering) ? 'Kamera an' : 'Kamera aus'} />
        </div>
      </div>
      {!isLocal && hover && part.media === 'camera' && (
        <div style={{ position: 'absolute', left: '50%', bottom: 10, transform: 'translateX(-50%)', display: 'flex', gap: 8, zIndex: 5 }}>
          <Button 
            onMouseDown={(e)=>{ e.preventDefault(); e.stopPropagation(); }}
            onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); handleForceMute(); }}
            onDoubleClick={(e)=>{ e.preventDefault(); e.stopPropagation(); }}
            aria-label={t('participant.forceMuteTitle')} title={t('participant.forceMuteTitle')} variant="danger">
            <FAIcon size="sm" name="microphone-slash" variant="solid" ariaLabel={t('participant.forceMute')} />
            {t('participant.forceMute')}
          </Button>
        </div>
      )}
    </div>
  );
}


