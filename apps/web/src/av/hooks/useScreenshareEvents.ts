/**
 * useScreenshareEvents Hook
 *
 * Monitors screenshare events and triggers callbacks when screensharing starts/stops.
 * Used for auto-fullscreen on remote screenshare start.
 */

import React from 'react';
import type { Room, RemoteParticipant, LocalParticipant } from 'livekit-client';
import type { AVManager } from '../avManager';
import { listPublications, readPubSource } from '../../types/livekit';

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

function checkLocalScreenshare(localParticipant: LocalParticipant | null | undefined, ctx: ScreenshareCheckCtx): void {
  if (!localParticipant) return;
  const localPubs = listPublications(localParticipant);
  const hasLocalScreen = localPubs.some((pub) => readPubSource(pub) === 'screen_share');

  if (hasLocalScreen && !ctx.localScreenshareRef.current) {
    ctx.localScreenshareRef.current = true;
    ctx.onLocalScreenshareStart?.();
  } else if (!hasLocalScreen && ctx.localScreenshareRef.current) {
    ctx.localScreenshareRef.current = false;
    ctx.onLocalScreenshareStop?.();
  }
}

function checkRemoteScreenshares(room: Room, ctx: ScreenshareCheckCtx): void {
  const currentScreenshares = new Set<string>();
  const remotes: RemoteParticipant[] = Array.from(room.remoteParticipants?.values?.() || []);
  for (const remote of remotes) {
    const p = remote;
    const pubs = listPublications(p);
    const hasScreen = pubs.some((pub) => readPubSource(pub) === 'screen_share');

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
    const room = ctx.avRef.current?.room;
    if (!room) return;
    checkLocalScreenshare(room.localParticipant, ctx);
    checkRemoteScreenshares(room, ctx);
  };
}

interface RoomWithEvents {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
}

async function attachLivekitListeners(room: Room, checkForNewScreenshares: () => void): Promise<() => void> {
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

    const r = room as unknown as RoomWithEvents;
    r.on(RoomEvent.TrackPublished, onTrackPublished);
    r.on(RoomEvent.TrackUnpublished, onTrackUnpublished);
    r.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    r.on(RoomEvent.LocalTrackPublished, onTrackPublished);
    r.on(RoomEvent.LocalTrackUnpublished, onTrackUnpublished);

    return () => {
      try {
        r.off(RoomEvent.TrackPublished, onTrackPublished);
        r.off(RoomEvent.TrackUnpublished, onTrackUnpublished);
        r.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
        r.off(RoomEvent.LocalTrackPublished, onTrackPublished);
        r.off(RoomEvent.LocalTrackUnpublished, onTrackUnpublished);
      } catch {}
    };
  } catch {
    // Fallback with polling
    const pollInterval = setInterval(checkForNewScreenshares, 1000);
    return () => clearInterval(pollInterval);
  }
}

function setupScreenshareEffect(ctx: ScreenshareCheckCtx): (() => void) | undefined {
  const room = ctx.avRef.current?.room;
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
    const room = avRef.current?.room;
    if (!room) return;

    const remotes: RemoteParticipant[] = Array.from(room.remoteParticipants?.values?.() || []);
    for (const remote of remotes) {
      const p = remote;
      const pubs = listPublications(p);
      const hasScreen = pubs.some((pub) => readPubSource(pub) === 'screen_share');

      if (hasScreen && !knownScreensharesRef.current.has(p.sid)) {
        knownScreensharesRef.current.add(p.sid);
        const displayName = p.name || p.identity || 'User';
        onRemoteScreenshareStart?.(p.sid, displayName);
      }
    }
  }, [avRef, onRemoteScreenshareStart]);

  return { forceCheck };
}
