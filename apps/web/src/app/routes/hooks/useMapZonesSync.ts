import React from 'react';
import { logger } from '../../../lib/logger';
import type { ZoneManager } from '../../../game/zoneManager';

type MeUser = { id: string; email: string; name?: string } | null;

type Params = {
  me: MeUser;
  apiBase: string;
  zoneRef: React.MutableRefObject<ZoneManager | null>;
  setEditor: (updater: any) => void;
};

/**
 * Reload zones after map change: clears stale portal-zone state and refetches
 * editor-state for the new map. Also listens for `server_zones_loaded` for
 * play-mode zone updates.
 */
export function useMapZonesSync({ me, apiBase, zoneRef, setEditor }: Params) {
  React.useEffect(() => {
    if (!me) return;
    const handler = (e: Event) => {
      void (async (e: Event) => {
        const mapId = (e as CustomEvent).detail?.mapId;
        if (!mapId) return;
        zoneRef.current?.resetForMapChange?.();
        try {
          const res = await fetch(`${apiBase}/maps/${encodeURIComponent(mapId)}/editor-state?t=${Date.now()}`, {
            credentials: 'include',
          });
          if (!res.ok) return;
          const data = await res.json();
          if (Array.isArray(data?.zones)) {
            const zones = data.zones.map((z: any) => ({
              name: z.name,
              points: Array.isArray(z.points) ? z.points : Array.isArray(z.polygon) ? z.polygon : [],
              capacity: z.capacity ?? undefined,
              type: z.type ?? undefined,
              portalTarget: z.portalTarget ?? undefined,
              portalSpawnX: z.portalSpawnX ?? undefined,
              portalSpawnY: z.portalSpawnY ?? undefined,
            }));
            setEditor((s: any) => ({ ...s, zones }));
            zoneRef.current?.setZones?.(zones);
          }
        } catch (err) {
          logger.debug('[WorldApp] Failed to reload zones after map change', err);
        }
      })(e);
    };
    window.addEventListener('map_zones_reload', handler);
    return () => window.removeEventListener('map_zones_reload', handler);
  }, [me, apiBase, zoneRef, setEditor]);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const zones = (e as CustomEvent).detail?.zones;
      if (Array.isArray(zones) && zones.length > 0) {
        zoneRef.current?.setZones?.(zones);
      }
    };
    window.addEventListener('server_zones_loaded', handler);
    return () => window.removeEventListener('server_zones_loaded', handler);
  }, [zoneRef]);
}
