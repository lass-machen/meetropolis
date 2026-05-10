import React from 'react';
import { logger } from '../../../lib/logger';
import type { ZoneManager } from '../../../game/zoneManager';
import type { EditorState, Zone } from '../../../services/EditorService';
import type { WorldMe } from './useWorldAppState';

type Params = {
  me: WorldMe;
  apiBase: string;
  zoneRef: React.MutableRefObject<ZoneManager | null>;
  setEditor: React.Dispatch<React.SetStateAction<EditorState>>;
};

type RemoteZone = {
  name?: unknown;
  points?: unknown;
  polygon?: unknown;
  capacity?: unknown;
  type?: unknown;
  portalTarget?: unknown;
  portalSpawnX?: unknown;
  portalSpawnY?: unknown;
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
        const detail = (e as CustomEvent<{ mapId?: string }>).detail;
        const mapId = detail?.mapId;
        if (!mapId) return;
        zoneRef.current?.resetForMapChange?.();
        try {
          const res = await fetch(`${apiBase}/maps/${encodeURIComponent(mapId)}/editor-state?t=${Date.now()}`, {
            credentials: 'include',
          });
          if (!res.ok) return;
          const data = (await res.json()) as { zones?: RemoteZone[] } | null;
          if (data && Array.isArray(data.zones)) {
            const zones: Zone[] = data.zones.map((z) => {
              const zone: Zone = {
                name: typeof z.name === 'string' ? z.name : '',
                points: Array.isArray(z.points)
                  ? (z.points as Zone['points'])
                  : Array.isArray(z.polygon)
                    ? (z.polygon as Zone['points'])
                    : [],
              };
              if (z.type === 'default' || z.type === 'portal') zone.type = z.type;
              if (typeof z.portalTarget === 'string') zone.portalTarget = z.portalTarget;
              if (typeof z.portalSpawnX === 'number') zone.portalSpawnX = z.portalSpawnX;
              if (typeof z.portalSpawnY === 'number') zone.portalSpawnY = z.portalSpawnY;
              return zone;
            });
            setEditor((s) => ({ ...s, zones }));
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
      const detail = (e as CustomEvent<{ zones?: Zone[] }>).detail;
      const zones = detail?.zones;
      if (Array.isArray(zones) && zones.length > 0) {
        zoneRef.current?.setZones?.(zones);
      }
    };
    window.addEventListener('server_zones_loaded', handler);
    return () => window.removeEventListener('server_zones_loaded', handler);
  }, [zoneRef]);
}
