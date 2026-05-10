import React from 'react';
import type { Room, RemoteParticipant, LocalParticipant, Participant } from 'livekit-client';
import { Icon } from '../Icon';
import { useTranslation } from 'react-i18next';
import { Button } from '../system/Button';
import { AvatarSprite } from './AvatarSprite';
import { getApiBaseFromWindow } from '../../lib/runtimeConfig';
import { listPublications, readPubSource, type TrackLike, type TrackPublicationLike } from '../../types/livekit';

type PartType = {
  sid: string;
  identity: string;
  hasVideo: boolean;
  hasMic: boolean;
  isSpeaking: boolean;
  media: 'camera' | 'screen';
  volume?: number;
  dnd?: boolean;
  avatarId?: string;
};

// Legacy room shape: older code paths still use `participants` instead of `remoteParticipants`.
interface LegacyRoom extends Room {
  participants?: Map<string, RemoteParticipant>;
}

type AnyParticipant = (Participant | RemoteParticipant | LocalParticipant) & { name?: string };

const getTrackId = (t: TrackLike | null | undefined): string | null =>
  t?.sid || t?.mediaStreamTrack?.id || (t as { id?: string } | null | undefined)?.id || null;

function findParticipant(
  room: LegacyRoom,
  baseSid: string,
  part: PartType,
): { p: AnyParticipant | null; baseSid: string } {
  const isLocalNow = room.localParticipant?.sid === baseSid;
  let p: AnyParticipant | null | undefined = isLocalNow
    ? room.localParticipant
    : room.participants?.get?.(baseSid) || room.remoteParticipants?.get?.(baseSid);
  if (p || isLocalNow) return { p: p ?? null, baseSid };
  const allParticipants: AnyParticipant[] = Array.from(room.remoteParticipants?.values() || []);
  const searchIdentity =
    part.media === 'screen' && part.identity.endsWith(' – Bildschirm') ? part.identity.slice(0, -14) : part.identity;
  p =
    allParticipants.find((participant) => (participant.name || participant.identity) === searchIdentity) ||
    allParticipants.find((participant) => participant.identity === searchIdentity);
  if (p) return { p, baseSid: p.sid };
  if (part.media === 'screen') {
    p = allParticipants.find((participant) =>
      part.identity.startsWith((participant.name || participant.identity) + ' –'),
    );
    if (p) return { p, baseSid: p.sid };
  }
  return { p: null, baseSid };
}

function findScreenParticipant(
  room: LegacyRoom,
  part: PartType,
  currentP: AnyParticipant | null,
): AnyParticipant | null {
  const allParticipants: AnyParticipant[] = Array.from(room.remoteParticipants?.values() || []);
  const searchIdentity = part.identity.endsWith(' – Bildschirm') ? part.identity.slice(0, -14) : part.identity;
  let next = allParticipants.find((participant) => {
    const pName = participant.name || participant.identity;
    return pName === searchIdentity || part.identity.startsWith(pName + ' –');
  });
  if (!next) {
    next = allParticipants.find(
      (participant) => participant.identity === searchIdentity || part.identity.startsWith(participant.identity + ' –'),
    );
  }
  return next || currentP;
}

function attachInitialTrack(
  p: AnyParticipant,
  part: PartType,
  el: HTMLVideoElement,
  attachedRef: React.MutableRefObject<string | null>,
): (() => void) | undefined {
  const pubs = listPublications(p);
  if (pubs.length === 0 && !p.trackPublications) return undefined;
  const target = part.media === 'screen' ? 'screen_share' : 'camera';
  const track = pubs.find((pub) => readPubSource(pub) === target)?.track ?? null;
  if (track && el) {
    try {
      el.muted = true;
      track.attach?.(el);
      attachedRef.current = getTrackId(track);
      return () => {
        try {
          track.detach?.(el);
        } catch {}
      };
    } catch {}
  } else {
    try {
      (el as HTMLVideoElement & { srcObject?: MediaStream | null }).srcObject = null;
      el.load?.();
    } catch {}
  }
  return undefined;
}

interface TryAttachState {
  p: AnyParticipant | null;
  baseSid: string;
  isLocalNow: boolean;
  el: HTMLVideoElement;
  room: LegacyRoom;
  part: PartType;
  attachedRef: React.MutableRefObject<string | null>;
  setIsVideoRendering: (v: boolean) => void;
  pollTimerRef: { current: ReturnType<typeof setInterval> | null };
}

function buildTryAttach(state: TryAttachState) {
  return () => {
    try {
      const { p, isLocalNow } = state;
      let currentP: AnyParticipant | null = p;
      if (!currentP && state.part.media === 'screen' && !isLocalNow) {
        currentP = findScreenParticipant(state.room, state.part, currentP);
        if (currentP && currentP !== p) {
          state.p = currentP;
          state.baseSid = currentP.sid;
        }
      }
      if (isLocalNow) currentP = state.room.localParticipant;
      if (!currentP) return;
      const pubsNow = listPublications(currentP);
      const target = state.part.media === 'screen' ? 'screen_share' : 'camera';
      const pub = pubsNow.find((p2) => readPubSource(p2) === target);
      if (pub && !isLocalNow && state.part.media === 'screen') {
        const isSubscribed = pub.isSubscribed ?? pub.subscribed ?? !!pub.track;
        if (!isSubscribed && typeof pub.setSubscribed === 'function') {
          try {
            pub.setSubscribed(true);
          } catch {}
        }
      }
      const trackObj = pub?.track ?? null;
      const trackId = getTrackId(trackObj);
      if (trackObj && state.el && trackId && state.attachedRef.current !== trackId) {
        try {
          if (state.el.srcObject) {
            try {
              (state.el as HTMLVideoElement & { srcObject?: MediaStream | null }).srcObject = null;
            } catch {}
          }
          state.el.muted = true;
          trackObj.attach?.(state.el);
          state.attachedRef.current = trackId;
          state.setIsVideoRendering(false);
          if (state.pollTimerRef.current) clearInterval(state.pollTimerRef.current);
        } catch {}
      }
    } catch {}
  };
}

interface RoomEventBus {
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  off?: (event: string, handler: (...args: unknown[]) => void) => void;
}

function setupRoomEvents(
  room: LegacyRoom,
  baseSid: string,
  part: PartType,
  el: HTMLVideoElement,
  isLocalNow: boolean,
  setIsVideoRendering: (v: boolean) => void,
): () => void {
  const onTrackSubscribed = (...args: unknown[]) => {
    const t = args[0] as TrackLike | undefined;
    const participant = args[2] as { sid?: string } | undefined;
    try {
      const src = (t?.source ?? t?.mediaStreamTrack?.kind) ? String(t?.source ?? t?.mediaStreamTrack?.kind) : undefined;
      const isDesired = part.media === 'screen' ? src === 'screen_share' : src === 'camera';
      if (participant?.sid === baseSid && isDesired && el) {
        try {
          el.muted = true;
          t?.attach?.(el);
          setIsVideoRendering(false);
        } catch {}
      }
    } catch {}
  };
  const onTrackUnsubscribed = (...args: unknown[]) => {
    const t = args[0] as TrackLike | undefined;
    const participant = args[2] as { sid?: string } | undefined;
    try {
      const src = (t?.source ?? t?.mediaStreamTrack?.kind) ? String(t?.source ?? t?.mediaStreamTrack?.kind) : undefined;
      const want = part.media === 'screen' ? 'screen_share' : 'camera';
      if (participant?.sid === baseSid && src === want && el) {
        try {
          t?.detach?.(el);
        } catch {}
        try {
          (el as HTMLVideoElement & { srcObject?: MediaStream | null }).srcObject = null;
          el.load?.();
        } catch {}
        setIsVideoRendering(false);
      }
    } catch {}
  };
  const onLocalTrackPublished = (...args: unknown[]) => {
    const publication = args[0] as TrackPublicationLike | undefined;
    try {
      const src = readPubSource(publication);
      const wantCamera = part.media === 'camera' && src === 'camera';
      const wantScreen = part.media === 'screen' && src === 'screen_share';
      if (isLocalNow && (wantCamera || wantScreen) && publication?.track && el) {
        try {
          el.muted = true;
          publication.track.attach?.(el);
          setIsVideoRendering(false);
        } catch {}
      }
    } catch {}
  };
  const onLocalTrackUnpublished = (...args: unknown[]) => {
    const publication = args[0] as TrackPublicationLike | undefined;
    try {
      const src = readPubSource(publication);
      const want = part.media === 'screen' ? 'screen_share' : 'camera';
      if (isLocalNow && src === want && el) {
        try {
          publication?.track?.detach?.(el);
        } catch {}
        try {
          (el as HTMLVideoElement & { srcObject?: MediaStream | null }).srcObject = null;
          el.load?.();
        } catch {}
        setIsVideoRendering(false);
      }
    } catch {}
  };
  let off: () => void = () => {};
  const r = room as unknown as RoomEventBus;
  void (async () => {
    try {
      const mod = await import('livekit-client');
      const RoomEvent = mod.RoomEvent;
      if (RoomEvent) {
        r.on?.(RoomEvent.TrackSubscribed, onTrackSubscribed);
        r.on?.(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
        r.on?.(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
        r.on?.(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
        off = () => {
          try {
            r.off?.(RoomEvent.TrackSubscribed, onTrackSubscribed);
            r.off?.(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
            r.off?.(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
            r.off?.(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
          } catch {}
        };
      } else {
        r.on?.('trackSubscribed', onTrackSubscribed);
        r.on?.('trackUnsubscribed', onTrackUnsubscribed);
        r.on?.('localTrackPublished', onLocalTrackPublished);
        r.on?.('localTrackUnpublished', onLocalTrackUnpublished);
        off = () => {
          try {
            r.off?.('trackSubscribed', onTrackSubscribed);
            r.off?.('trackUnsubscribed', onTrackUnsubscribed);
            r.off?.('localTrackPublished', onLocalTrackPublished);
            r.off?.('localTrackUnpublished', onLocalTrackUnpublished);
          } catch {}
        };
      }
    } catch {}
  })();
  return () => off();
}

function useVideoTrackAttachment(
  part: PartType,
  roomGetter: () => Room | undefined,
  videoRef: React.RefObject<HTMLVideoElement | null>,
) {
  const [isVideoRendering, setIsVideoRendering] = React.useState(false);
  const [isLocal, setIsLocal] = React.useState(false);
  const attachedTrackIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const room = roomGetter() as LegacyRoom | undefined;
    const el = videoRef.current;
    if (!room || !room.localParticipant || !el) return;

    try {
      (el as HTMLVideoElement & { srcObject?: MediaStream | null }).srcObject = null;
    } catch {}
    attachedTrackIdRef.current = null;
    setIsVideoRendering(false);

    let baseSid = (part.sid || '').split(':')[0];
    const found = findParticipant(room, baseSid, part);
    const p = found.p;
    baseSid = found.baseSid;
    const isLocalNow = room.localParticipant?.sid === baseSid;
    setIsLocal(isLocalNow);
    if (!p || !p.trackPublications) return;

    const initialCleanup = attachInitialTrack(p, part, el, attachedTrackIdRef);
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

    const pollTimerRef: { current: ReturnType<typeof setInterval> | null } = { current: null };
    const sharedState: TryAttachState = {
      p,
      baseSid,
      isLocalNow,
      el,
      room,
      part,
      attachedRef: attachedTrackIdRef,
      setIsVideoRendering,
      pollTimerRef,
    };
    const tryAttach = buildTryAttach(sharedState);
    tryAttach();
    const isScreenMedia = part.media === 'screen';
    const pollInterval = isScreenMedia ? 1000 : 300;
    pollTimerRef.current = setInterval(tryAttach, pollInterval);
    if (!isScreenMedia)
      setTimeout(() => {
        try {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        } catch {}
      }, 10000);

    const offEvents = setupRoomEvents(room, baseSid, part, el, isLocalNow, setIsVideoRendering);

    return () => {
      const node = videoRef.current;
      try {
        node?.removeEventListener('loadeddata', onLoaded);
      } catch {}
      try {
        node?.removeEventListener('playing', onPlaying);
      } catch {}
      try {
        node?.removeEventListener('emptied', onEmptied);
      } catch {}
      try {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      } catch {}
      initialCleanup?.();
      offEvents();
      attachedTrackIdRef.current = null;
      try {
        if (node) {
          (node as HTMLVideoElement & { srcObject?: MediaStream | null }).srcObject = null;
        }
      } catch {}
    };
  }, [part.sid, part.hasVideo, roomGetter]);

  return { isVideoRendering, isLocal };
}

function StatusBadges({
  part,
  isVideoRendering,
  t,
}: {
  part: PartType;
  isVideoRendering: boolean;
  t: (k: string) => string;
}) {
  const isDnd = !!part.dnd;
  return (
    <>
      {isDnd && (
        <div
          title={t('participant.dnd')}
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 26,
            height: 26,
            borderRadius: 999,
            background: 'var(--uc-badge-off)',
            border: '1px solid var(--uc-badge-border-off)',
          }}
        >
          <Icon size="xs" name="moon" ariaLabel={t('participant.dnd')} />
        </div>
      )}
      <div
        title={part.hasMic ? t('participant.micOn') : t('participant.micOff')}
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 26,
          height: 26,
          borderRadius: 999,
          background: part.hasMic ? 'var(--uc-badge-on)' : 'var(--uc-badge-off)',
          border: `1px solid ${part.hasMic ? 'var(--uc-badge-border-on)' : 'var(--uc-badge-border-off)'}`,
        }}
      >
        <Icon
          size="xs"
          name={part.hasMic ? 'microphone' : 'microphone-off'}
          ariaLabel={part.hasMic ? t('participant.micOn') : t('participant.micOff')}
        />
      </div>
      <div
        title={part.hasVideo || isVideoRendering ? t('participant.camOn') : t('participant.camOff')}
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 26,
          height: 26,
          borderRadius: 999,
          background: part.hasVideo || isVideoRendering ? 'var(--uc-badge-on)' : 'var(--uc-badge-off)',
          border: `1px solid ${part.hasVideo || isVideoRendering ? 'var(--uc-badge-border-on)' : 'var(--uc-badge-border-off)'}`,
        }}
      >
        <Icon
          size="xs"
          name={part.hasVideo || isVideoRendering ? 'video' : 'video-off'}
          ariaLabel={part.hasVideo || isVideoRendering ? t('participant.camOn') : t('participant.camOff')}
        />
      </div>
    </>
  );
}

async function performForceMute(part: PartType, roomGetter: () => Room | undefined) {
  try {
    const label = (part.identity || '').replace(/\s+–\s*Bildschirm$/, '');
    let targetIdentity = label;
    try {
      const room = roomGetter?.() as LegacyRoom | undefined;
      if (room) {
        const local = room.localParticipant as (LocalParticipant & { name?: string }) | undefined;
        if (local && (local.name === label || local.identity === label)) {
          targetIdentity = local.identity;
        } else {
          const allRemotes: AnyParticipant[] = Array.from(
            room.remoteParticipants?.values?.() || room.participants?.values?.() || [],
          );
          const found =
            allRemotes.find((p) => (p?.name || p?.identity) === label) || allRemotes.find((p) => p?.identity === label);
          if (found?.identity) targetIdentity = found.identity;
        }
      }
    } catch {}
    const base = getApiBaseFromWindow();
    await fetch(`${base}/controls/for/${encodeURIComponent(targetIdentity)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ mic: false }),
    });
  } catch {}
}

function CollapsedPill({
  part,
  isVideoRendering,
  opacity,
  disabled,
  videoRef,
  t,
}: {
  part: PartType;
  isVideoRendering: boolean;
  opacity: number;
  disabled: boolean;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  t: (k: string) => string;
}) {
  const pillBorder = part.isSpeaking ? '1px solid rgba(16,185,129,0.75)' : '1px solid rgba(255,255,255,0.22)';
  const pillBg = part.isSpeaking ? 'rgba(50,255,187,0.20)' : 'rgba(255,255,255,0.1)';
  const pillShadow = part.isSpeaking
    ? '0 0 8px -1px rgba(16,185,129,0.80), 0 1px 3px 0 rgba(0,0,0,0.10)'
    : '0 1px 3px rgba(0,0,0,0.1)';

  return (
    <div
      className="uc-pill"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 6,
        borderRadius: 25,
        border: pillBorder,
        background: pillBg,
        boxShadow: pillShadow,
        opacity,
        transition: 'opacity 0.3s ease-in-out, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
        pointerEvents: 'auto',
        filter: disabled ? 'grayscale(90%) brightness(0.8)' : undefined,
      }}
    >
      <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
      <div
        style={{
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
        }}
      >
        <span className="uc-pill-avatar">
          <AvatarSprite {...(part.avatarId ? { avatarId: part.avatarId } : {})} size={12} />
        </span>
        {part.identity}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <StatusBadges part={part} isVideoRendering={isVideoRendering} t={t} />
      </div>
    </div>
  );
}

function ExpandedCard({
  part,
  isVideoRendering,
  isLocal,
  hover,
  setHover,
  opacity,
  disabled,
  full,
  zoom,
  videoRef,
  roomGetter,
  t,
}: {
  part: PartType;
  isVideoRendering: boolean;
  isLocal: boolean;
  hover: boolean;
  setHover: React.Dispatch<React.SetStateAction<boolean>>;
  opacity: number;
  disabled: boolean;
  full: boolean | undefined;
  zoom: number;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  roomGetter: () => Room | undefined;
  t: (k: string) => string;
}) {
  const speakingColor = 'var(--speaking-color, #10b981)';
  const borderColor = part.isSpeaking ? speakingColor : 'var(--border)';
  const glow = part.isSpeaking
    ? `0 0 0 2px var(--speaking-glow, rgba(16,185,129,0.35)), var(--shadow)`
    : 'var(--shadow)';
  const isScreen = part.media === 'screen';

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: full ? 'min(calc(100vw - 64px), 1920px)' : '100%',
        maxWidth: full ? undefined : 200,
        maxHeight: full ? 'calc(100vh - 64px)' : undefined,
        aspectRatio: full ? undefined : '16 / 9',
        position: 'relative',
        borderRadius: 14,
        overflow: 'hidden',
        background: 'var(--uc-glass)',
        border: `1px solid ${borderColor}`,
        boxShadow: glow,
        opacity,
        transition: 'opacity 0.3s ease-in-out',
        pointerEvents: 'auto',
        filter: disabled ? 'grayscale(90%) brightness(0.8)' : undefined,
        height: full ? 'auto' : undefined,
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: '100%',
          height: full ? 'auto' : '100%',
          maxHeight: full ? 'calc(100vh - 64px)' : undefined,
          objectFit: isScreen ? 'contain' : full ? 'contain' : 'cover',
          background: 'transparent',
          transform: isLocal && part.media === 'camera' ? `scaleX(-1) scale(${zoom})` : `scale(${zoom})`,
          transformOrigin: 'center center',
          pointerEvents: full ? 'none' : undefined,
        }}
      />
      {!(part.hasVideo || isVideoRendering) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--fg)',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {part.identity}
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          background: 'var(--bg-btn-bg, var(--glass))',
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <AvatarSprite {...(part.avatarId ? { avatarId: part.avatarId } : {})} size={12} />
        <div
          style={{
            fontSize: 12,
            color: 'var(--fg)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {part.identity}
        </div>
      </div>
      <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 6 }}>
        <StatusBadges part={part} isVideoRendering={isVideoRendering} t={t} />
      </div>
      {!isLocal && hover && part.media === 'camera' && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 10,
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 8,
            zIndex: 5,
          }}
        >
          <Button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void performForceMute(part, roomGetter);
            }}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            aria-label={t('participant.forceMuteTitle')}
            title={t('participant.forceMuteTitle')}
            variant="danger"
          >
            <Icon size="sm" name="microphone-off" ariaLabel={t('participant.forceMute')} />
            {t('participant.forceMute')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ParticipantCard(props: {
  part: PartType;
  roomGetter: () => Room | undefined;
  compact?: boolean;
  full?: boolean;
  zoom?: number;
  collapsed?: boolean;
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const { part, roomGetter, full, zoom = 1, collapsed } = props;
  const [hover, setHover] = React.useState(false);
  const { t } = useTranslation('common');
  const { isVideoRendering, isLocal } = useVideoTrackAttachment(part, roomGetter, videoRef);

  const volume = part.volume ?? 1;
  const opacity = isLocal ? 1 : 0.4 + volume * 0.6;
  const isDnd = !!part.dnd;
  const disabled = (!isLocal && volume <= 0.1) || isDnd;

  if (collapsed) {
    return (
      <CollapsedPill
        part={part}
        isVideoRendering={isVideoRendering}
        opacity={opacity}
        disabled={disabled}
        videoRef={videoRef}
        t={t}
      />
    );
  }
  return (
    <ExpandedCard
      part={part}
      isVideoRendering={isVideoRendering}
      isLocal={isLocal}
      hover={hover}
      setHover={setHover}
      opacity={opacity}
      disabled={disabled}
      full={full}
      zoom={zoom}
      videoRef={videoRef}
      roomGetter={roomGetter}
      t={t}
    />
  );
}
