import React from 'react';
import type { Room } from 'livekit-client';
import { listPublications, readPubSource, type TrackLike, type TrackPublicationLike } from '../../../types/livekit';
import type { AnyParticipant, LegacyRoom, PartType } from './types';
import { findParticipant, findScreenParticipant, getTrackId } from './participantUtils';

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

export function useVideoTrackAttachment(
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
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: videoRef.current is captured into `node` at cleanup time; the ref-cleanup-timing warning is benign because we explicitly want the current DOM node at unmount
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: sid + hasVideo are the lifecycle triggers we care about; part.media is constant per participant card, videoRef is a stable mutable ref, capturing full part would tear down and re-attach on every property update
  }, [part.sid, part.hasVideo, roomGetter]);

  return { isVideoRendering, isLocal };
}
