import React from 'react';
import { FAIcon } from '../FAIcon';
import { useTranslation } from 'react-i18next';
import { Button } from '../system/Button';
import { AvatarSprite } from './AvatarSprite';

export function ParticipantCard(props: { part: { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera'|'screen'; volume?: number; dnd?: boolean; avatarId?: string }, roomGetter: () => any | undefined, compact?: boolean, full?: boolean, zoom?: number, collapsed?: boolean }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const { part, roomGetter, compact, full, zoom = 1, collapsed } = props;
  const [isVideoRendering, setIsVideoRendering] = React.useState(false);
  const [isLocal, setIsLocal] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const { t } = useTranslation('common');
  // Track which track is currently attached to detect changes
  const attachedTrackIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const room: any = roomGetter();
    const el = videoRef.current;
    if (!room || !room.localParticipant || !el) return;

    // Reset video element and tracking ref at start of effect
    try { (el as any).srcObject = null; } catch {}
    attachedTrackIdRef.current = null;
    setIsVideoRendering(false);

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

    // Helper to get track ID for comparison
    const getTrackId = (t: any) => t?.sid || t?.mediaStreamTrack?.id || t?.id || null;

    if (track && el) {
      try {
        el.muted = true;
        track.attach(el);
        attachedTrackIdRef.current = getTrackId(track);
        cleanup = () => { try { track.detach(el); } catch {} };
      } catch {}
    } else {
      try { (el as any).srcObject = null; el.load?.(); } catch {}
      setIsVideoRendering(false);
    }

    const tryAttach = () => {
      try {
        let currentP = p;
        // For remote screenshare, try to find participant if not found initially
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
        // For local participant, always use room.localParticipant to get fresh state
        if (isLocalNow) {
          currentP = room.localParticipant;
        }
        if (!currentP) return;

        const pubsNow: any[] = Array.from(currentP.trackPublications?.values?.() || []);
        const pub = pubsNow.find((pub: any) => {
          const src = (pub?.source || pub?.track?.source);
          if (part.media === 'screen') return src === 'screen_share';
          return src === 'camera';
        });

        // For remote tracks: try to subscribe if not subscribed yet
        if (pub && !isLocalNow && part.media === 'screen') {
          const isSubscribed = (pub as any).isSubscribed ?? (pub as any).subscribed ?? !!(pub as any).track;
          if (!isSubscribed && typeof (pub as any).setSubscribed === 'function') {
            try { (pub as any).setSubscribed(true); } catch {}
          }
        }

        const trackObj = (pub as any)?.track;
        const trackId = getTrackId(trackObj);

        // Attach if: track exists AND (no track attached OR different track)
        if (trackObj && el && trackId && attachedTrackIdRef.current !== trackId) {
          try {
            // Detach old track if any
            if (el.srcObject) {
              try { (el as any).srcObject = null; } catch {}
            }
            el.muted = true;
            trackObj.attach(el);
            attachedTrackIdRef.current = trackId;
            setIsVideoRendering(false);
            clearInterval(pollTimer);
          } catch {}
        }
      } catch {}
    };
    // Run immediately once, then poll
    tryAttach();
    // Screen shares need persistent polling because the track may be
    // re-published while this component stays mounted (same part.sid).
    // Camera tracks only poll for 10s since they don't have this re-publish pattern.
    const isScreenMedia = part.media === 'screen';
    const pollInterval = isScreenMedia ? 1000 : 300;
    pollTimer = setInterval(tryAttach, pollInterval);
    if (!isScreenMedia) {
      setTimeout(() => { try { clearInterval(pollTimer); } catch {} }, 10000);
    }

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
    const onTrackUnsubscribed = (t: any, _publication: any, participant: any) => {
      try {
        const src = (t?.source || t?.mediaStreamTrack?.kind) as string | undefined;
        const want = part.media === 'screen' ? 'screen_share' : 'camera';
        if (participant?.sid === baseSid && src === want && el) {
          try { t.detach?.(el); } catch {}
          try { (el as any).srcObject = null; el.load?.(); } catch {}
          setIsVideoRendering(false);
        }
      } catch {}
    };
    const onTrackPublished = (_t: any, _publication: any, _participant: any) => {
      try {} catch {}
    };
    const onLocalTrackUnpublished = (publication: any, _participant?: any) => {
      try {
        const src = (publication?.source || publication?.track?.source) as string | undefined;
        const want = part.media === 'screen' ? 'screen_share' : 'camera';
        if (isLocalNow && src === want && el) {
          try { publication?.track?.detach?.(el); } catch {}
          try { (el as any).srcObject = null; el.load?.(); } catch {}
          setIsVideoRendering(false);
        }
      } catch {}
    };
    (async () => {
      try {
        const mod = await import('livekit-client');
        const RoomEvent = (mod as any).RoomEvent;
        if (RoomEvent) {
          const onLocalTrackPublished = (publication: any) => {
            try {
              const src = (publication?.source || publication?.track?.source) as string | undefined;
              const wantCamera = (part.media === 'camera' && src === 'camera');
              const wantScreen = (part.media === 'screen' && src === 'screen_share');
              if (isLocalNow && (wantCamera || wantScreen) && publication?.track && el) {
                try { el.muted = true; publication.track.attach(el); setIsVideoRendering(false); } catch {}
              }
            } catch {}
          };
          room.on?.(RoomEvent.TrackSubscribed, onTrackSubscribed);
          room.on?.(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
          room.on?.(RoomEvent.TrackPublished, onTrackPublished);
          room.on?.(RoomEvent.LocalTrackPublished, onLocalTrackPublished as any);
          room.on?.(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished as any);
          // Store cleanup function capturing handler
          cleanup = (() => {
            try {
              room.off?.(RoomEvent.TrackSubscribed, onTrackSubscribed);
              room.off?.(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
              room.off?.(RoomEvent.TrackPublished, onTrackPublished);
              room.off?.(RoomEvent.LocalTrackPublished, onLocalTrackPublished as any);
              room.off?.(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished as any);
            } catch {}
          });
        } else {
          room.on?.('trackSubscribed', onTrackSubscribed);
          room.on?.('trackUnsubscribed', onTrackUnsubscribed);
          room.on?.('trackPublished', onTrackPublished);
          const onLocalTrackPublished2 = () => { try { if (isLocalNow && el) setTimeout(()=>setIsVideoRendering(false),0); } catch {} };
          room.on?.('localTrackPublished', onLocalTrackPublished2);
          const onLocalTrackUnpublished2 = () => {
            try {
              if (isLocalNow && el) {
                try { (el as any).srcObject = null; el.load?.(); } catch {}
                setIsVideoRendering(false);
              }
            } catch {}
          };
          room.on?.('localTrackUnpublished', onLocalTrackUnpublished2);
          cleanup = (() => {
            try {
              room.off?.('trackSubscribed', onTrackSubscribed);
              room.off?.('trackUnsubscribed', onTrackUnsubscribed);
              room.off?.('trackPublished', onTrackPublished);
              room.off?.('localTrackPublished', onLocalTrackPublished2);
              room.off?.('localTrackUnpublished', onLocalTrackUnpublished2);
            } catch {}
          });
        }
      } catch {}
    })();
    return () => {
      const node = videoRef.current;
      try { node?.removeEventListener('loadeddata', onLoaded); } catch {}
      try { node?.removeEventListener('playing', onPlaying); } catch {}
      try { node?.removeEventListener('emptied', onEmptied); } catch {}
      try { clearInterval(pollTimer); } catch {}
      cleanup?.();
      // Reset srcObject and tracking ref on cleanup
      attachedTrackIdRef.current = null;
      try { if (node) { (node as any).srcObject = null; } } catch {}
    };
  }, [part.sid, part.hasVideo, roomGetter]);

  const volume = part.volume ?? 1;
  const opacity = isLocal ? 1 : (0.4 + (volume * 0.6));
  
  // Konsistente Farben via CSS-Variablen
  const speakingColor = 'var(--speaking-color, #10b981)';
  const borderColor = part.isSpeaking ? speakingColor : 'var(--border)';
  const glow = part.isSpeaking ? `0 0 0 2px var(--speaking-glow, rgba(16,185,129,0.35)), var(--shadow)` : 'var(--shadow)';
  const isScreen = part.media === 'screen';
  const aspect = full ? undefined : (isScreen ? '16 / 9' : '16 / 9');
  const targetSize = full ? undefined : (compact ? '100%' : '36vh');
  const minW = full ? undefined : (compact ? 260 : 420);
  const isDnd = !!part.dnd;
  const disabled = (!isLocal && (volume <= 0.1)) || isDnd;

  const handleForceMute = async () => {
    try {
      const label = (part.identity || '').replace(/\s+–\s*Bildschirm$/, '');
      let targetIdentity = label;
      try {
        const room: any = roomGetter?.();
        if (room) {
          const local = room.localParticipant;
          if (local && (local.name === label || local.identity === label)) {
            targetIdentity = local.identity;
          } else {
            const allRemotes: any[] = Array.from((room.remoteParticipants?.values?.() || room.participants?.values?.() || []) as any);
            const found = allRemotes.find((p: any) => (p?.name || p?.identity) === label) || allRemotes.find((p: any) => p?.identity === label);
            if (found?.identity) targetIdentity = found.identity;
          }
        }
      } catch {}
      const anyWin = window as any;
      const base = anyWin.desktop?.apiBase || anyWin.__MEETROPOLIS_API_BASE__ || anyWin.VITE_API_BASE || (import.meta as any).env?.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2567`;
      await fetch(`${base}/controls/for/${encodeURIComponent(targetIdentity)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mic: false })
      });
    } catch {}
  };

  // Collapsed pill mode
  if (collapsed) {
    const pillBorder = part.isSpeaking
      ? '1px solid rgba(16,185,129,0.75)'
      : '1px solid rgba(255,255,255,0.22)';
    const pillBg = part.isSpeaking
      ? 'rgba(50,255,187,0.20)'
      : 'rgba(255,255,255,0.1)';
    const pillShadow = part.isSpeaking
      ? '0 0 8px -1px rgba(16,185,129,0.80), 0 1px 3px 0 rgba(0,0,0,0.10)'
      : '0 1px 3px rgba(0,0,0,0.1)';
    const pillRadius = 25;

    return (
      <div className="uc-pill" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 6,
        borderRadius: pillRadius,
        border: pillBorder,
        background: pillBg,
        boxShadow: pillShadow,
        opacity,
        transition: 'opacity 0.3s ease-in-out, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
        pointerEvents: 'auto',
        filter: disabled ? 'grayscale(90%) brightness(0.8)' : undefined,
      }}>
        {/* Hidden video element to maintain LiveKit track attachment */}
        <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 11,
          lineHeight: '12px',
          fontWeight: 600,
          textShadow: '0 0 1px rgba(0,0,0,0.5)',
          padding: '5px 8px',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 25,
          background: 'rgba(255,255,255,0.1)',
          color: 'var(--fg)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          <span className="uc-pill-avatar"><AvatarSprite {...(part.avatarId ? { avatarId: part.avatarId } : {})} size={12} /></span>
          {part.identity}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isDnd && (
            <div title={t('participant.dnd')} style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 999, background: 'var(--uc-badge-off)', border: '1px solid var(--uc-badge-border-off)' }}>
              <FAIcon size="xs" name="moon" variant="solid" ariaLabel={t('participant.dnd')} />
            </div>
          )}
          <div title={part.hasMic ? t('participant.micOn') : t('participant.micOff')} style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 999, background: part.hasMic ? 'var(--uc-badge-on)' : 'var(--uc-badge-off)', border: `1px solid ${part.hasMic ? 'var(--uc-badge-border-on)' : 'var(--uc-badge-border-off)'}` }}>
            <FAIcon size="xs" name={part.hasMic ? 'microphone' : 'microphone-slash'} variant="solid" ariaLabel={part.hasMic ? t('participant.micOn') : t('participant.micOff')} />
          </div>
          <div title={(part.hasVideo || isVideoRendering) ? t('participant.camOn') : t('participant.camOff')} style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 999, background: (part.hasVideo || isVideoRendering) ? 'var(--uc-badge-on)' : 'var(--uc-badge-off)', border: `1px solid ${(part.hasVideo || isVideoRendering) ? 'var(--uc-badge-border-on)' : 'var(--uc-badge-border-off)'}` }}>
            <FAIcon size="xs" name={(part.hasVideo || isVideoRendering) ? 'video' : 'video-slash'} variant="solid" ariaLabel={(part.hasVideo || isVideoRendering) ? t('participant.camOn') : t('participant.camOff')} />
          </div>
        </div>
      </div>
    );
  }

  // Expanded mode (existing layout with AvatarSprite in name badge)
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{
      width: full ? 'min(calc(100vw - 64px), 1920px)' : '100%',
      maxWidth: full ? undefined : 200,
      maxHeight: full ? 'calc(100vh - 64px)' : undefined,
      aspectRatio: full ? undefined : '16 / 9',
      position: 'relative', borderRadius: 14, overflow: 'hidden', background: 'var(--uc-glass)', border: `1px solid ${borderColor}`, boxShadow: glow,
      opacity: opacity,
      transition: 'opacity 0.3s ease-in-out',
      pointerEvents: 'auto',
      filter: disabled ? 'grayscale(90%) brightness(0.8)' : undefined,
      height: full ? 'auto' : undefined,
    }}>
      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: full ? 'auto' : '100%', maxHeight: full ? 'calc(100vh - 64px)' : undefined, objectFit: isScreen ? 'contain' : (full ? 'contain' : 'cover'), background: 'transparent', transform: (isLocal && part.media==='camera') ? `scaleX(-1) scale(${zoom})` : `scale(${zoom})`, transformOrigin: 'center center', pointerEvents: full ? 'none' : undefined }} />
      {!(part.hasVideo || isVideoRendering) && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--fg)', fontWeight: 600, fontSize: 14 }}>
          {part.identity}
        </div>
      )}
      <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', background: 'var(--bg-btn-bg, var(--glass))', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
        <AvatarSprite {...(part.avatarId ? { avatarId: part.avatarId } : {})} size={12} />
        <div style={{ fontSize: 12, color: 'var(--fg)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{part.identity}</div>
      </div>
      <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 6 }}>
        {isDnd && (
          <div title={t('participant.dnd')} style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 999, background: 'var(--uc-badge-off)', border: '1px solid var(--uc-badge-border-off)' }}>
            <FAIcon size="xs" name="moon" variant="solid" ariaLabel={t('participant.dnd')} />
          </div>
        )}
        <div title={part.hasMic ? t('participant.micOn') : t('participant.micOff')} style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 999, background: part.hasMic ? 'var(--uc-badge-on)' : 'var(--uc-badge-off)', border: `1px solid ${part.hasMic ? 'var(--uc-badge-border-on)' : 'var(--uc-badge-border-off)'}` }}>
          <FAIcon size="xs" name={part.hasMic ? 'microphone' : 'microphone-slash'} variant="solid" ariaLabel={part.hasMic ? t('participant.micOn') : t('participant.micOff')} />
        </div>
        <div title={(part.hasVideo || isVideoRendering) ? t('participant.camOn') : t('participant.camOff')} style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 999, background: (part.hasVideo || isVideoRendering) ? 'var(--uc-badge-on)' : 'var(--uc-badge-off)', border: `1px solid ${(part.hasVideo || isVideoRendering) ? 'var(--uc-badge-border-on)' : 'var(--uc-badge-border-off)'}` }}>
          <FAIcon size="xs" name={(part.hasVideo || isVideoRendering) ? 'video' : 'video-slash'} variant="solid" ariaLabel={(part.hasVideo || isVideoRendering) ? t('participant.camOn') : t('participant.camOff')} />
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


