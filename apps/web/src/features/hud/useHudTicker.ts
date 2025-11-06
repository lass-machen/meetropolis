import React from 'react';

type AnyRef<T> = React.MutableRefObject<T>;

interface UseHudTickerParams {
  enabled: boolean;
  zoneRef: AnyRef<any>;
  avRef: AnyRef<any>;
  setHud: React.Dispatch<React.SetStateAction<{ zone?: string; follow?: string | null; avRoom?: string | null }>>;
  bubblePendingRef: AnyRef<{ targetId: string; dest?: { x: number; y: number } } | null>;
  localPosRef: AnyRef<{ id: string; x: number; y: number }>;
  remotesRef: AnyRef<Record<string, { x: number; y: number }>>;
  onZoneParticipantRefresh: () => void;
  volumeRef: AnyRef<{ update?: () => Record<string, number> | undefined } | null>;
  setParticipantVolumesRef: (vols: Record<string, number>) => void;
  onArrivedAtBubbleTarget: (targetId: string) => void;
}

export function useHudTicker(params: UseHudTickerParams) {
  const {
    enabled,
    zoneRef,
    avRef,
    setHud,
    bubblePendingRef,
    localPosRef,
    remotesRef,
    onZoneParticipantRefresh,
    volumeRef,
    setParticipantVolumesRef,
    onArrivedAtBubbleTarget,
  } = params;

  React.useEffect(() => {
    if (!enabled) return;
    let participantListLastZone: string | null = null;
    let lastParticipantUpdate = 0;
    const hudTimer = setInterval(() => {
      try {
        const z = zoneRef.current?.getCurrent?.();
        const next: { zone?: string; follow?: string | null; avRoom?: string | null } = {
          follow: null,
          avRoom: avRef.current?.activeRoom ?? null,
        } as any;
        if (typeof z === 'string') next.zone = z;
        setHud(next);

        if (bubblePendingRef.current && localPosRef.current) {
          const { dest, targetId } = bubblePendingRef.current;
          const targetPos = remotesRef.current[targetId];
          let arrived = false;
          if (dest) {
            const dx = (localPosRef.current.x || 0) - dest.x;
            const dy = (localPosRef.current.y || 0) - dest.y;
            arrived = (dx * dx + dy * dy) < 12 * 12;
          }
          if (!arrived && targetPos) {
            const dx = (localPosRef.current.x || 0) - targetPos.x;
            const dy = (localPosRef.current.y || 0) - targetPos.y;
            arrived = (dx * dx + dy * dy) < 20 * 20;
          }
          if (arrived) {
            onArrivedAtBubbleTarget(targetId);
            bubblePendingRef.current = null;
          }
        }

        const zoneName = zoneRef.current?.getCurrent?.() ?? null;
        if (zoneName !== participantListLastZone || Date.now() - lastParticipantUpdate > 2000) {
          participantListLastZone = (zoneName ?? null) as any;
          lastParticipantUpdate = Date.now();
          onZoneParticipantRefresh();
        }

        const room: any = avRef.current?.room as any;
        if (room && room.localParticipant && room.localParticipant.trackPublications) {
          // AV-State Mirror wird außerhalb gepflegt
        }
        const volumes = volumeRef.current?.update?.();
        if (volumes) setParticipantVolumesRef(volumes);
      } catch {}
    }, 250);

    return () => {
      clearInterval(hudTimer);
    };
  }, [enabled, avRef, bubblePendingRef, localPosRef, onArrivedAtBubbleTarget, onZoneParticipantRefresh, setHud, setParticipantVolumesRef, volumeRef, zoneRef]);
}


