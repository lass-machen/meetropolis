import React from 'react';
import { FAIcon } from '../FAIcon';
import { useTranslation } from 'react-i18next';
import { Button } from '../system/Button';
import { AvatarSprite } from './AvatarSprite';
import { getApiBaseFromWindow } from '../../lib/runtimeConfig';

type PartType = { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera'|'screen'; volume?: number; dnd?: boolean; avatarId?: string };

const getTrackId = (t: any) => t?.sid || t?.mediaStreamTrack?.id || t?.id || null;

function findParticipant(room: any, baseSid: string, part: PartType): { p: any; baseSid: string } {
  const isLocalNow = room.localParticipant?.sid === baseSid;
  let p: any = isLocalNow ? room.localParticipant : (room.participants?.get?.(baseSid) || room.remoteParticipants?.get?.(baseSid));
  if (p || isLocalNow) return { p, baseSid };
  const allParticipants = Array.from(room.remoteParticipants?.values() || []);
  const searchIdentity = part.media === 'screen' && part.identity.endsWith(' – Bildschirm')
    ? part.identity.slice(0, -14)
    : part.identity;
  p = allParticipants.find((participant: any) => (participant.name || participant.identity) === searchIdentity)
    || allParticipants.find((participant: any) => participant.identity === searchIdentity);
  if (p) return { p, baseSid: p.sid };
  if (part.media === 'screen') {
    p = allParticipants.find((participant: any) => part.identity.startsWith(((participant.name || participant.identity) as string) + ' –'));
    if (p) return { p, baseSid: p.sid };
  }
  return { p: null, baseSid };
}

function findScreenParticipant(room: any, part: PartType, currentP: any): any {
  const allParticipants = Array.from(room.remoteParticipants?.values() || []);
  const searchIdentity = part.identity.endsWith(' – Bildschirm')
    ? part.identity.slice(0, -14)
    : part.identity;
  let next = allParticipants.find((participant: any) => {
    const pName = participant.name || participant.identity;
    return pName === searchIdentity || part.identity.startsWith(pName + ' –');
  });
  if (!next) {
    next = allParticipants.find((participant: any) => participant.identity === searchIdentity || part.identity.startsWith(participant.identity + ' –'));
  }
  return next || currentP;
}

function attachInitialTrack(p: any, part: PartType, el: HTMLVideoElement, attachedRef: React.MutableRefObject<string | null>): (() => void) | undefined {
  if (!p?.trackPublications) return undefined;
  const pubs: any[] = Array.from(p.trackPublications?.values?.() || []);
  const track = part.media === 'screen'
    ? pubs.find(pub => (pub?.source || pub?.track?.source) === 'screen_share')?.track
    : pubs.find(pub => (pub?.source || pub?.track?.source) === 'camera')?.track;
  if (track && el) {
    try {
      el.muted = true;
      track.attach(el);
      attachedRef.current = getTrackId(track);
      return () => { try { track.detach(el); } catch {} };
    } catch {}
  } else {
    try { (el as any).srcObject = null; el.load?.(); } catch {}
  }
  return undefined;
}

function buildTryAttach(state: { p: any; baseSid: string; isLocalNow: boolean; el: HTMLVideoElement; room: any; part: PartType; attachedRef: React.MutableRefObject<string | null>; setIsVideoRendering: (v: boolean) => void; pollTimerRef: { current: any } }) {
  return () => {
    try {
      let { p, isLocalNow } = state;
      let currentP = p;
      if (!currentP && state.part.media === 'screen' && !isLocalNow) {
        currentP = findScreenParticipant(state.room, state.part, currentP);
        if (currentP && currentP !== p) {
          state.p = currentP;
          state.baseSid = currentP.sid;
        }
      }
      if (isLocalNow) currentP = state.room.localParticipant;
      if (!currentP) return;
      const pubsNow: any[] = Array.from(currentP.trackPublications?.values?.() || []);
      const pub = pubsNow.find((pub: any) => {
        const src = (pub?.source || pub?.track?.source);
        return state.part.media === 'screen' ? src === 'screen_share' : src === 'camera';
      });
      if (pub && !isLocalNow && state.part.media === 'screen') {
        const isSubscribed = (pub as any).isSubscribed ?? (pub as any).subscribed ?? !!(pub as any).track;
        if (!isSubscribed && typeof (pub as any).setSubscribed === 'function') {
          try { (pub as any).setSubscribed(true); } catch {}
        }
      }
      const trackObj = (pub as any)?.track;
      const trackId = getTrackId(trackObj);
      if (trackObj && state.el && trackId && state.attachedRef.current !== trackId) {
        try {
          if (state.el.srcObject) { try { (state.el as any).srcObject = null; } catch {} }
          state.el.muted = true;
          trackObj.attach(state.el);
          state.attachedRef.current = trackId;
          state.setIsVideoRendering(false);
          clearInterval(state.pollTimerRef.current);
        } catch {}
      }
    } catch {}
  };
}

function setupRoomEvents(room: any, baseSid: string, part: PartType, el: HTMLVideoElement, isLocalNow: boolean, setIsVideoRendering: (v: boolean) => void): () => void {
  const onTrackSubscribed = (t: any, _publication: any, participant: any) => {
    try {
      const src = (t?.source || t?.mediaStreamTrack?.kind) as string | undefined;
      const isDesired = part.media === 'screen' ? (src === 'screen_share') : (src === 'camera');
      if (participant?.sid === baseSid && isDesired && el) {
        try { el.muted = true; t.attach(el); setIsVideoRendering(false); } catch {}
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
  const onLocalTrackUnpublished = (publication: any) => {
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
  let off: () => void = () => {};
  (async () => {
    try {
      const mod = await import('livekit-client');
      const RoomEvent = (mod as any).RoomEvent;
      if (RoomEvent) {
        room.on?.(RoomEvent.TrackSubscribed, onTrackSubscribed);
        room.on?.(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
        room.on?.(RoomEvent.LocalTrackPublished, onLocalTrackPublished as any);
        room.on?.(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished as any);
        off = () => {
          try {
            room.off?.(RoomEvent.TrackSubscribed, onTrackSubscribed);
            room.off?.(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
            room.off?.(RoomEvent.LocalTrackPublished, onLocalTrackPublished as any);
            room.off?.(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished as any);
          } catch {}
        };
      } else {
        room.on?.('trackSubscribed', onTrackSubscribed);
        room.on?.('trackUnsubscribed', onTrackUnsubscribed);
        room.on?.('localTrackPublished', onLocalTrackPublished);
        room.on?.('localTrackUnpublished', onLocalTrackUnpublished);
        off = () => {
          try {
            room.off?.('trackSubscribed', onTrackSubscribed);
            room.off?.('trackUnsubscribed', onTrackUnsubscribed);
            room.off?.('localTrackPublished', onLocalTrackPublished);
            room.off?.('localTrackUnpublished', onLocalTrackUnpublished);
          } catch {}
        };
      }
    } catch {}
  })();
  return () => off();
}

function useVideoTrackAttachment(part: PartType, roomGetter: () => any | undefined, videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [isVideoRendering, setIsVideoRendering] = React.useState(false);
  const [isLocal, setIsLocal] = React.useState(false);
  const attachedTrackIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const room: any = roomGetter();
    const el = videoRef.current;
    if (!room || !room.localParticipant || !el) return;

    try { (el as any).srcObject = null; } catch {}
    attachedTrackIdRef.current = null;
    setIsVideoRendering(false);

    let baseSid = (part.sid || '').split(':')[0];
    const found = findParticipant(room, baseSid, part);
    let p = found.p;
    baseSid = found.baseSid;
    const isLocalNow = room.localParticipant?.sid === baseSid;
    setIsLocal(isLocalNow);
    if (!p || !p.trackPublications) return;

    let initialCleanup = attachInitialTrack(p, part, el, attachedTrackIdRef);
    const onLoaded = () => { try { if (el.readyState >= 2) setIsVideoRendering(true); } catch {} };
    const onPlaying = () => setIsVideoRendering(true);
    const onEmptied = () => setIsVideoRendering(false);
    el.addEventListener('loadeddata', onLoaded);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('emptied', onEmptied);

    const pollTimerRef = { current: null as any };
    const sharedState = { p, baseSid, isLocalNow, el, room, part, attachedRef: attachedTrackIdRef, setIsVideoRendering, pollTimerRef };
    const tryAttach = buildTryAttach(sharedState);
    tryAttach();
    const isScreenMedia = part.media === 'screen';
    const pollInterval = isScreenMedia ? 1000 : 300;
    pollTimerRef.current = setInterval(tryAttach, pollInterval);
    if (!isScreenMedia) setTimeout(() => { try { clearInterval(pollTimerRef.current); } catch {} }, 10000);

    const offEvents = setupRoomEvents(room, baseSid, part, el, isLocalNow, setIsVideoRendering);

    return () => {
      const node = videoRef.current;
      try { node?.removeEventListener('loadeddata', onLoaded); } catch {}
      try { node?.removeEventListener('playing', onPlaying); } catch {}
      try { node?.removeEventListener('emptied', onEmptied); } catch {}
      try { clearInterval(pollTimerRef.current); } catch {}
      initialCleanup?.();
      offEvents();
      attachedTrackIdRef.current = null;
      try { if (node) { (node as any).srcObject = null; } } catch {}
    };
  }, [part.sid, part.hasVideo, roomGetter]);

  return { isVideoRendering, isLocal };
}

function StatusBadges({ part, isVideoRendering, t }: { part: PartType; isVideoRendering: boolean; t: (k: string) => string }) {
  const isDnd = !!part.dnd;
  return (
    <>
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
    </>
  );
}

async function performForceMute(part: PartType, roomGetter: () => any | undefined) {
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
    const base = getApiBaseFromWindow();
    await fetch(`${base}/controls/for/${encodeURIComponent(targetIdentity)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ mic: false }) });
  } catch {}
}

function CollapsedPill({ part, isVideoRendering, opacity, disabled, videoRef, t }: { part: PartType; isVideoRendering: boolean; opacity: number; disabled: boolean; videoRef: React.MutableRefObject<HTMLVideoElement | null>; t: (k: string) => string }) {
  const pillBorder = part.isSpeaking ? '1px solid rgba(16,185,129,0.75)' : '1px solid rgba(255,255,255,0.22)';
  const pillBg = part.isSpeaking ? 'rgba(50,255,187,0.20)' : 'rgba(255,255,255,0.1)';
  const pillShadow = part.isSpeaking ? '0 0 8px -1px rgba(16,185,129,0.80), 0 1px 3px 0 rgba(0,0,0,0.10)' : '0 1px 3px rgba(0,0,0,0.1)';

  return (
    <div className="uc-pill" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 6, borderRadius: 25, border: pillBorder, background: pillBg, boxShadow: pillShadow, opacity, transition: 'opacity 0.3s ease-in-out, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease', pointerEvents: 'auto', filter: disabled ? 'grayscale(90%) brightness(0.8)' : undefined }}>
      <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, lineHeight: '12px', fontWeight: 600, textShadow: '0 0 1px rgba(0,0,0,0.5)', padding: '5px 8px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 25, background: 'rgba(255,255,255,0.1)', color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <span className="uc-pill-avatar"><AvatarSprite {...(part.avatarId ? { avatarId: part.avatarId } : {})} size={12} /></span>
        {part.identity}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <StatusBadges part={part} isVideoRendering={isVideoRendering} t={t} />
      </div>
    </div>
  );
}

function ExpandedCard({ part, isVideoRendering, isLocal, hover, setHover, opacity, disabled, full, zoom, videoRef, roomGetter, t }: { part: PartType; isVideoRendering: boolean; isLocal: boolean; hover: boolean; setHover: React.Dispatch<React.SetStateAction<boolean>>; opacity: number; disabled: boolean; full: boolean | undefined; zoom: number; videoRef: React.MutableRefObject<HTMLVideoElement | null>; roomGetter: () => any | undefined; t: (k: string) => string }) {
  const speakingColor = 'var(--speaking-color, #10b981)';
  const borderColor = part.isSpeaking ? speakingColor : 'var(--border)';
  const glow = part.isSpeaking ? `0 0 0 2px var(--speaking-glow, rgba(16,185,129,0.35)), var(--shadow)` : 'var(--shadow)';
  const isScreen = part.media === 'screen';

  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ width: full ? 'min(calc(100vw - 64px), 1920px)' : '100%', maxWidth: full ? undefined : 200, maxHeight: full ? 'calc(100vh - 64px)' : undefined, aspectRatio: full ? undefined : '16 / 9', position: 'relative', borderRadius: 14, overflow: 'hidden', background: 'var(--uc-glass)', border: `1px solid ${borderColor}`, boxShadow: glow, opacity, transition: 'opacity 0.3s ease-in-out', pointerEvents: 'auto', filter: disabled ? 'grayscale(90%) brightness(0.8)' : undefined, height: full ? 'auto' : undefined }}>
      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: full ? 'auto' : '100%', maxHeight: full ? 'calc(100vh - 64px)' : undefined, objectFit: isScreen ? 'contain' : (full ? 'contain' : 'cover'), background: 'transparent', transform: (isLocal && part.media==='camera') ? `scaleX(-1) scale(${zoom})` : `scale(${zoom})`, transformOrigin: 'center center', pointerEvents: full ? 'none' : undefined }} />
      {!(part.hasVideo || isVideoRendering) && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--fg)', fontWeight: 600, fontSize: 14 }}>{part.identity}</div>
      )}
      <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', background: 'var(--bg-btn-bg, var(--glass))', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
        <AvatarSprite {...(part.avatarId ? { avatarId: part.avatarId } : {})} size={12} />
        <div style={{ fontSize: 12, color: 'var(--fg)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{part.identity}</div>
      </div>
      <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 6 }}>
        <StatusBadges part={part} isVideoRendering={isVideoRendering} t={t} />
      </div>
      {!isLocal && hover && part.media === 'camera' && (
        <div style={{ position: 'absolute', left: '50%', bottom: 10, transform: 'translateX(-50%)', display: 'flex', gap: 8, zIndex: 5 }}>
          <Button
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); performForceMute(part, roomGetter); }}
            onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            aria-label={t('participant.forceMuteTitle')} title={t('participant.forceMuteTitle')} variant="danger">
            <FAIcon size="sm" name="microphone-slash" variant="solid" ariaLabel={t('participant.forceMute')} />
            {t('participant.forceMute')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ParticipantCard(props: { part: PartType, roomGetter: () => any | undefined, compact?: boolean, full?: boolean, zoom?: number, collapsed?: boolean }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const { part, roomGetter, full, zoom = 1, collapsed } = props;
  const [hover, setHover] = React.useState(false);
  const { t } = useTranslation('common');
  const { isVideoRendering, isLocal } = useVideoTrackAttachment(part, roomGetter, videoRef);

  const volume = part.volume ?? 1;
  const opacity = isLocal ? 1 : (0.4 + (volume * 0.6));
  const isDnd = !!part.dnd;
  const disabled = (!isLocal && (volume <= 0.1)) || isDnd;

  if (collapsed) {
    return <CollapsedPill part={part} isVideoRendering={isVideoRendering} opacity={opacity} disabled={disabled} videoRef={videoRef} t={t} />;
  }
  return <ExpandedCard part={part} isVideoRendering={isVideoRendering} isLocal={isLocal} hover={hover} setHover={setHover} opacity={opacity} disabled={disabled} full={full} zoom={zoom} videoRef={videoRef} roomGetter={roomGetter} t={t} />;
}


