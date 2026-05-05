import React, { useCallback, useMemo } from 'react';

/**
 * Computes derived UI helpers (participantsToRender, mini-zones,
 * handleExpandWithScreen, handleAuthComplete) used by the WorldApp shell.
 */
export function useWorldUiHelpers(params: {
  refs: any;
  ui: any;
  auth: any;
  toggleMiniMode: () => void;
}) {
  const { refs, ui, auth, toggleMiniMode } = params;

  const participantsToRender = useMemo(() =>
    ui.uiParticipants.length > 0
      ? ui.uiParticipants
      : [{
          sid: (refs.avRef.current?.room?.localParticipant?.sid ?? 'local'),
          identity: auth.me?.name || auth.me?.email || '',
          hasVideo: false,
          hasMic: ui.avState.mic,
          isSpeaking: false,
          media: 'camera' as const,
        }],
    [ui.uiParticipants, auth.me?.name, auth.me?.email, ui.avState.mic, refs.avRef]
  );

  const handleAuthComplete = useCallback(async () => { auth.setAuthRefetchTrigger((prev: number) => prev + 1); }, [auth.setAuthRefetchTrigger]);

  const getMiniZones = useCallback(() => {
    const raw = refs.zoneRef.current?.getZones?.() || [];
    return raw.map((z: any) => ({
      name: z.name as string,
      points: ((z.points || []) as any[])
        .map((p: any) => Array.isArray(p) ? { x: p[0], y: p[1] } : p)
        .filter((p: any) => p && typeof p.x === 'number' && typeof p.y === 'number'),
    }));
  }, [refs.zoneRef]);

  const handleExpandWithScreen = useCallback((screenSid: string) => {
    toggleMiniMode();
    ui.setSelectedSid(screenSid);
    ui.setOverlayZoom(1);
  }, [toggleMiniMode, ui.setSelectedSid, ui.setOverlayZoom]);

  return { participantsToRender, handleAuthComplete, getMiniZones, handleExpandWithScreen };
}

/**
 * Wires the participant list rebuild whenever `me` changes and the buildList
 * timer cleanup on unmount.
 */
export function useParticipantListEffects(params: {
  refs: any;
  me: any;
  buildParticipantList: () => void;
}) {
  const { refs, me, buildParticipantList } = params;
  // me?.id reicht als dep — me selbst kann durch jeden auth-Refresh neue
  // Object-Identitaet bekommen, was eine Render-Loop ausloest. Die einzige
  // semantisch relevante Aenderung ist die userId.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (me) {
      const localIdentity = refs.avRef.current?.room?.localParticipant?.identity || me.id;
      refs.identityToNameMap.current[localIdentity] = me.name || me.email || me.id;
      buildParticipantList();
    }
  }, [me?.id]);

  React.useEffect(() => {
    return () => {
      try { if (refs.buildListTimerRef.current) clearTimeout(refs.buildListTimerRef.current); } catch {}
      try { if (refs.buildListRafRef.current !== null) cancelAnimationFrame(refs.buildListRafRef.current); } catch {}
    };
  }, [refs.buildListTimerRef, refs.buildListRafRef]);
}
