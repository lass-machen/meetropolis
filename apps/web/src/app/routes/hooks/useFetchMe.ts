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

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function fetchMeWithRetry(apiBase: string): Promise<any | null> {
  const networkRetryBackoff = [0, 300, 1000];
  for (let i = 0; i < networkRetryBackoff.length; i++) {
    if (i > 0) await sleep(networkRetryBackoff[i]);
    try {
      const res = await fetch(`${apiBase}/auth/me`, { credentials: 'include' });
      if (res.ok) return await res.json();
      if (res.status === 401 || res.status === 403) return null;
    } catch (e) {
      logger.debug('[WorldApp] /auth/me network error, retrying', e);
    }
  }
  return null;
}

function applyCapabilities(user: any, setCapabilities: UseFetchMeParams['setCapabilities']) {
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
}

function applyPosition(user: any, pos: { x: number; y: number } | null, localPosRef: UseFetchMeParams['localPosRef']) {
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    try { localPosRef.current = { id: user.id, x: pos.x, y: pos.y }; } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    try { (window as any).initialPlayerPosition = { x: pos.x, y: pos.y }; } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
  }
}

async function resolvePosition(user: any, apiBase: string, localPosRef: UseFetchMeParams['localPosRef']): Promise<any> {
  if (user.lastPosition && typeof user.lastPosition.x === 'number' && typeof user.lastPosition.y === 'number') {
    applyPosition(user, { x: user.lastPosition.x, y: user.lastPosition.y }, localPosRef);
    return user;
  }
  const posBackoff = [150, 300, 600, 1200];
  let current = user;
  for (let i = 0; i < posBackoff.length; i++) {
    await sleep(posBackoff[i]);
    try {
      const res = await fetch(`${apiBase}/auth/me`, { credentials: 'include' });
      if (res.ok) {
        const next = await res.json();
        current = next;
        if (next.lastPosition && typeof next.lastPosition.x === 'number' && typeof next.lastPosition.y === 'number') {
          applyPosition(next, { x: next.lastPosition.x, y: next.lastPosition.y }, localPosRef);
          return current;
        }
      }
    } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
  }
  return current;
}

async function restoreMapName(user: any) {
  try {
    const lastMap = user.lastPosition?.mapName;
    if (lastMap && typeof lastMap === 'string') {
      const { useMapStore } = await import('../../../state/mapStore');
      useMapStore.getState().setCurrentMapName(lastMap);
    }
  } catch {}
}

async function runFetchMe(params: UseFetchMeParams) {
  const { apiBase, localPosRef, setMe, setIsInternalOwner, setCapabilities, setPositionReady, setAuthChecked } = params;
  try {
    let user = await fetchMeWithRetry(apiBase);
    if (!user) { setMe(null); return; }
    try { setIsInternalOwner(!!user.isInternalOwner); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    applyCapabilities(user, setCapabilities);
    if (user.avatarId) {
      localStorage.setItem('avatarId', user.avatarId);
    }
    user = await resolvePosition(user, apiBase, localPosRef);
    await restoreMapName(user);
    setMe(user);
    setPositionReady(true);
  } catch {
    setMe(null);
  } finally {
    setAuthChecked(true);
  }
}

export function useFetchMe(params: UseFetchMeParams) {
  const { apiBase, refetchTrigger = 0 } = params;
  useEffect(() => {
    runFetchMe(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, refetchTrigger]);

  return null;
}
