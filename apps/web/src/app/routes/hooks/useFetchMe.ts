import { useEffect } from 'react';
import { logger } from '../../../lib/logger';

export type AdminCapabilities = {
  hasBilling: boolean;
  hasAdminEnterprise: boolean;
  isMultiTenant: boolean;
};

export const DEFAULT_CAPABILITIES: AdminCapabilities = {
  hasBilling: false,
  hasAdminEnterprise: false,
  isMultiTenant: false,
};

interface UseFetchMeParams {
  apiBase: string;
  localPosRef: React.MutableRefObject<{ id: string; x?: number; y?: number }>;
  setMe: React.Dispatch<React.SetStateAction<{ id: string; email: string; name?: string; onboardingCompleted?: boolean; role?: string } | null>>;
  setIsInternalOwner: React.Dispatch<React.SetStateAction<boolean>>;
  setCapabilities: React.Dispatch<React.SetStateAction<AdminCapabilities>>;
  setPositionReady: React.Dispatch<React.SetStateAction<boolean>>;
  setAuthChecked: React.Dispatch<React.SetStateAction<boolean>>;
  refetchTrigger?: number;
}

export function useFetchMe({
  apiBase,
  localPosRef,
  setMe,
  setIsInternalOwner,
  setCapabilities,
  setPositionReady,
  setAuthChecked,
  refetchTrigger = 0,
}: UseFetchMeParams) {
  useEffect(() => {
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    async function fetchMe() {
      try {
        const networkRetryBackoff = [0, 300, 1000];
        let user: any | null = null;
        for (let i = 0; i < networkRetryBackoff.length; i++) {
          if (i > 0) await sleep(networkRetryBackoff[i]);
          try {
            const res = await fetch(`${apiBase}/auth/me`, { credentials: 'include' });
            if (res.ok) { user = await res.json(); break; }
            // Definitive auth failure (401/403) — no point retrying
            if (res.status === 401 || res.status === 403) break;
          } catch (e) {
            // Network error — retry makes sense
            logger.debug('[WorldApp] /auth/me network error, retrying', e);
          }
        }
        if (!user) { setMe(null); return; }
        try { setIsInternalOwner(!!user.isInternalOwner); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
        try {
          const caps = user.capabilities;
          if (caps && typeof caps === 'object') {
            setCapabilities({
              hasBilling: !!caps.hasBilling,
              hasAdminEnterprise: !!caps.hasAdminEnterprise,
              isMultiTenant: !!caps.isMultiTenant,
            });
          } else {
            setCapabilities(DEFAULT_CAPABILITIES);
          }
        } catch (e) { logger.debug('[WorldApp] Failed to set capabilities', e); }

        // Sync server avatarId to localStorage (server is source of truth)
        if (user.avatarId) {
          localStorage.setItem('avatarId', user.avatarId);
        }

        const applyPosition = (pos: { x: number; y: number } | null) => {
          if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
            try { localPosRef.current = { id: user.id, x: pos.x, y: pos.y }; } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
            try { (window as any).initialPlayerPosition = { x: pos.x, y: pos.y }; } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
          }
        };

        let posApplied = false;
        if (user.lastPosition && typeof user.lastPosition.x === 'number' && typeof user.lastPosition.y === 'number') {
          applyPosition({ x: user.lastPosition.x, y: user.lastPosition.y });
          posApplied = true;
        } else {
          const posBackoff = [150, 300, 600, 1200];
          for (let i = 0; i < posBackoff.length && !posApplied; i++) {
            await sleep(posBackoff[i]);
            try {
              const res = await fetch(`${apiBase}/auth/me`, { credentials: 'include' });
              if (res.ok) {
                const next = await res.json();
                user = next;
                if (next.lastPosition && typeof next.lastPosition.x === 'number' && typeof next.lastPosition.y === 'number') {
                  applyPosition({ x: next.lastPosition.x, y: next.lastPosition.y });
                  posApplied = true;
                  break;
                }
              }
            } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
          }
        }

        // Restore saved map name before game initialization
        try {
          const lastMap = user.lastPosition?.mapName;
          if (lastMap && typeof lastMap === 'string') {
            const { useMapStore } = await import('../../../state/mapStore');
            useMapStore.getState().setCurrentMapName(lastMap);
          }
        } catch {}

        setMe(user);
        setPositionReady(true);
      } catch {
        setMe(null);
      } finally {
        setAuthChecked(true);
      }
    }

    fetchMe();
  }, [apiBase, refetchTrigger]);

  return null;
}
