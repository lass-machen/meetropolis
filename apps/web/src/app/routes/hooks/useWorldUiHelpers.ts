import React, { useCallback, useMemo } from 'react';
import type { WorldRefs, WorldUi, WorldAuth, UiParticipantShape, WorldMe } from './useWorldAppState';

type MiniZonePoint = { x: number; y: number };
type RawZonePoint = MiniZonePoint | [number, number] | { x?: unknown; y?: unknown };
type RawZone = { name?: unknown; points?: RawZonePoint[] };

/**
 * Computes derived UI helpers (participantsToRender, mini-zones,
 * handleExpandWithScreen, handleAuthComplete) used by the WorldApp shell.
 */
export function useWorldUiHelpers(params: {
  refs: WorldRefs;
  ui: WorldUi;
  auth: WorldAuth;
  toggleMiniMode: () => void;
}) {
  const { refs, ui, auth, toggleMiniMode } = params;

  const participantsToRender = useMemo<UiParticipantShape[]>(
    () =>
      ui.uiParticipants.length > 0
        ? ui.uiParticipants
        : [
            {
              sid: refs.avRef.current?.room?.localParticipant?.sid ?? 'local',
              identity: auth.me?.name || auth.me?.email || '',
              hasVideo: false,
              hasMic: ui.avState.mic,
              isSpeaking: false,
              media: 'camera' as const,
            },
          ],
    [ui.uiParticipants, auth.me?.name, auth.me?.email, ui.avState.mic, refs.avRef],
  );

  const handleAuthComplete = useCallback(() => {
    auth.setAuthRefetchTrigger((prev) => prev + 1);
  }, [auth.setAuthRefetchTrigger]);

  const getMiniZones = useCallback(() => {
    const raw = (refs.zoneRef.current?.getZones?.() || []) as RawZone[];
    return raw.map((z) => ({
      name: typeof z.name === 'string' ? z.name : '',
      points: (z.points || [])
        .map<MiniZonePoint | null>((p) => {
          if (Array.isArray(p)) return { x: p[0], y: p[1] };
          const px = (p as { x?: unknown }).x;
          const py = (p as { y?: unknown }).y;
          if (typeof px === 'number' && typeof py === 'number') return { x: px, y: py };
          return null;
        })
        .filter((p): p is MiniZonePoint => p !== null),
    }));
  }, [refs.zoneRef]);

  const handleExpandWithScreen = useCallback(
    (screenSid: string) => {
      toggleMiniMode();
      ui.setSelectedSid(screenSid);
      ui.setOverlayZoom(1);
    },
    [toggleMiniMode, ui.setSelectedSid, ui.setOverlayZoom],
  );

  return { participantsToRender, handleAuthComplete, getMiniZones, handleExpandWithScreen };
}

/**
 * Wires the participant list rebuild whenever `me` changes and the buildList
 * timer cleanup on unmount.
 */
export function useParticipantListEffects(params: { refs: WorldRefs; me: WorldMe; buildParticipantList: () => void }) {
  const { refs, me, buildParticipantList } = params;
  // Depend on me?.id rather than me: any auth refresh can give `me` a fresh
  // object identity and trigger a render loop, even though the only
  // semantically relevant change is the userId.

  React.useEffect(() => {
    if (me) {
      const localIdentity = refs.avRef.current?.room?.localParticipant?.identity || me.id;
      refs.identityToNameMap.current[localIdentity] = me.name || me.email || me.id;
      buildParticipantList();
    }
  }, [me?.id]);

  React.useEffect(() => {
    return () => {
      try {
        if (refs.buildListTimerRef.current) clearTimeout(refs.buildListTimerRef.current);
      } catch {}
      try {
        if (refs.buildListRafRef.current !== null) cancelAnimationFrame(refs.buildListRafRef.current);
      } catch {}
    };
  }, [refs.buildListTimerRef, refs.buildListRafRef]);
}
