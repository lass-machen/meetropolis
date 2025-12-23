import { useEffect } from 'react';
import { logger } from '../../../lib/logger';

interface UseFetchMeParams {
  apiBase: string;
  localPosRef: React.MutableRefObject<{ id: string; x?: number; y?: number }>;
  setMe: React.Dispatch<React.SetStateAction<{ id: string; email: string; name?: string } | null>>;
  setIsInternalOwner: React.Dispatch<React.SetStateAction<boolean>>;
  setPositionReady: React.Dispatch<React.SetStateAction<boolean>>;
  setAuthChecked: React.Dispatch<React.SetStateAction<boolean>>;
  refetchTrigger?: number;
}

export function useFetchMe({
  apiBase,
  localPosRef,
  setMe,
  setIsInternalOwner,
  setPositionReady,
  setAuthChecked,
  refetchTrigger = 0,
}: UseFetchMeParams) {
  useEffect(() => {
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    async function fetchMe() {
      try {
        const authBackoff = [0, 150, 300, 600, 1200, 2000];
        let user: any | null = null;
        for (let i = 0; i < authBackoff.length; i++) {
          if (i > 0) await sleep(authBackoff[i]);
          try {
            const res = await fetch(`${apiBase}/auth/me`, { credentials: 'include' });
            if (res.ok) { user = await res.json(); break; }
          } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
        }
        if (!user) { setMe(null); return; }
        try { setIsInternalOwner(!!user.isInternalOwner); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }

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
