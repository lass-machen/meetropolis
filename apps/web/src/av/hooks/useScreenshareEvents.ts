/**
 * useScreenshareEvents Hook
 *
 * Monitors screenshare events and triggers callbacks when screensharing starts/stops.
 * Used for auto-fullscreen on remote screenshare start.
 */

import React from 'react';
import type { AVManager } from '../avManager';

interface UseScreenshareEventsArgs {
  avRef: React.MutableRefObject<AVManager | null>;
  enabled: boolean;
  onRemoteScreenshareStart?: (participantSid: string, participantIdentity: string) => void;
  onRemoteScreenshareStop?: (participantSid: string) => void;
  onLocalScreenshareStart?: () => void;
  onLocalScreenshareStop?: () => void;
}

type ScreenshareCheckCtx = {
  avRef: React.MutableRefObject<AVManager | null>;
  knownScreensharesRef: React.MutableRefObject<Set<string>>;
  localScreenshareRef: React.MutableRefObject<boolean>;
  onRemoteScreenshareStart: ((sid: string, identity: string) => void) | undefined;
  onRemoteScreenshareStop: ((sid: string) => void) | undefined;
  onLocalScreenshareStart: (() => void) | undefined;
  onLocalScreenshareStop: (() => void) | undefined;
};

function checkLocalScreenshare(localParticipant: any, ctx: ScreenshareCheckCtx): void {
  if (!localParticipant) return;
  const localPubs = Array.from(localParticipant.trackPublications?.values?.() || []);
  const hasLocalScreen = localPubs.some((pub: any) => {
    const source = pub?.source || pub?.track?.source;
    return source === 'screen_share';
  });

  if (hasLocalScreen && !ctx.localScreenshareRef.current) {
    ctx.localScreenshareRef.current = true;
    ctx.onLocalScreenshareStart?.();
  } else if (!hasLocalScreen && ctx.localScreenshareRef.current) {
    ctx.localScreenshareRef.current = false;
    ctx.onLocalScreenshareStop?.();
  }
}

function checkRemoteScreenshares(room: any, ctx: ScreenshareCheckCtx): void {
  const currentScreenshares = new Set<string>();
  const remotes = Array.from(room.remoteParticipants?.values?.() || []);
  for (const remote of remotes) {
    const p = remote as any;
    const pubs = Array.from(p.trackPublications?.values?.() || []);
    const hasScreen = pubs.some((pub: any) => {
      const source = pub?.source || pub?.track?.source;
      return source === 'screen_share';
    });

    if (hasScreen) {
      currentScreenshares.add(p.sid);
      if (!ctx.knownScreensharesRef.current.has(p.sid)) {
        const displayName = p.name || p.identity || 'User';
        ctx.onRemoteScreenshareStart?.(p.sid, displayName);
      }
    }
  }

  for (const sid of ctx.knownScreensharesRef.current) {
    if (!currentScreenshares.has(sid)) {
      ctx.onRemoteScreenshareStop?.(sid);
    }
  }

  ctx.knownScreensharesRef.current = currentScreenshares;
}

function buildCheckForNewScreenshares(ctx: ScreenshareCheckCtx) {
  return () => {
    const room = ctx.avRef.current?.room as any;
    if (!room) return;
    checkLocalScreenshare(room.localParticipant, ctx);
    checkRemoteScreenshares(room, ctx);
  };
}

async function attachLivekitListeners(room: any, checkForNewScreenshares: () => void): Promise<() => void> {
  try {
    const { RoomEvent } = await import('livekit-client');
    const onTrackPublished = () => {
      setTimeout(checkForNewScreenshares, 100);
    };
    const onTrackUnpublished = () => {
      setTimeout(checkForNewScreenshares, 100);
    };
    const onTrackSubscribed = () => {
      setTimeout(checkForNewScreenshares, 100);
    };

    room.on(RoomEvent.TrackPublished, onTrackPublished);
    room.on(RoomEvent.TrackUnpublished, onTrackUnpublished);
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.LocalTrackPublished, onTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, onTrackUnpublished);

    return () => {
      try {
        room.off(RoomEvent.TrackPublished, onTrackPublished);
        room.off(RoomEvent.TrackUnpublished, onTrackUnpublished);
        room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
        room.off(RoomEvent.LocalTrackPublished, onTrackPublished);
        room.off(RoomEvent.LocalTrackUnpublished, onTrackUnpublished);
      } catch {}
    };
  } catch {
    // Fallback with polling
    const pollInterval = setInterval(checkForNewScreenshares, 1000);
    return () => clearInterval(pollInterval);
  }
}

function setupScreenshareEffect(ctx: ScreenshareCheckCtx): (() => void) | undefined {
  const room = ctx.avRef.current?.room as any;
  if (!room) return undefined;

  let cleanup: (() => void) | null = null;
  const checkForNewScreenshares = buildCheckForNewScreenshares(ctx);

  // Initial check
  checkForNewScreenshares();

  // Set up event listeners
  void (async () => {
    cleanup = await attachLivekitListeners(room, checkForNewScreenshares);
  })();

  // Also poll periodically to catch any missed events
  const pollInterval = setInterval(checkForNewScreenshares, 2000);

  return () => {
    cleanup?.();
    clearInterval(pollInterval);
  };
}

export function useScreenshareEvents({
  avRef,
  enabled,
  onRemoteScreenshareStart,
  onRemoteScreenshareStop,
  onLocalScreenshareStart,
  onLocalScreenshareStop,
}: UseScreenshareEventsArgs) {
  // Track known screenshare participants to detect new ones
  const knownScreensharesRef = React.useRef<Set<string>>(new Set());
  const localScreenshareRef = React.useRef<boolean>(false);

  React.useEffect(() => {
    if (!enabled) return;
    const ctx: ScreenshareCheckCtx = {
      avRef,
      knownScreensharesRef,
      localScreenshareRef,
      onRemoteScreenshareStart,
      onRemoteScreenshareStop,
      onLocalScreenshareStart,
      onLocalScreenshareStop,
    };
    return setupScreenshareEffect(ctx);
  }, [
    enabled,
    avRef,
    onRemoteScreenshareStart,
    onRemoteScreenshareStop,
    onLocalScreenshareStart,
    onLocalScreenshareStop,
  ]);

  // Return helper to manually trigger a check (useful after connection)
  const forceCheck = React.useCallback(() => {
    const room = avRef.current?.room as any;
    if (!room) return;

    const remotes = Array.from(room.remoteParticipants?.values?.() || []);
    for (const remote of remotes) {
      const p = remote as any;
      const pubs = Array.from(p.trackPublications?.values?.() || []);
      const hasScreen = pubs.some((pub: any) => {
        const source = pub?.source || pub?.track?.source;
        return source === 'screen_share';
      });

      if (hasScreen && !knownScreensharesRef.current.has(p.sid)) {
        knownScreensharesRef.current.add(p.sid);
        const displayName = p.name || p.identity || 'User';
        onRemoteScreenshareStart?.(p.sid, displayName);
      }
    }
  }, [avRef, onRemoteScreenshareStart]);

  return { forceCheck };
}
