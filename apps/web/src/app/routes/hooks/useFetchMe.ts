import { useEffect } from 'react';
import { logger } from '../../../lib/logger';
import { computeBackoffDelayMs, type BackoffOptions } from '../../../lib/backoff';
import { setAuthTenantSlug } from '../../../lib/colyseus';

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

// Shape of the `/auth/me` response we rely on. Server returns more fields
// but we only consume these.
export type MeResponse = {
  id: string;
  email: string;
  name?: string;
  onboardingCompleted?: boolean;
  role?: string;
  /** Verification status (auth-core). Unverified users are not locked out. */
  emailVerified?: boolean;
  isInternalOwner?: boolean;
  avatarId?: string;
  // Authenticated tenant slug; fed to the Colyseus world-room partition.
  tenantSlug?: string;
  capabilities?: {
    hasBilling?: unknown;
    hasAdminEnterprise?: unknown;
    isMultiTenant?: unknown;
  };
  lastPosition?: {
    x?: unknown;
    y?: unknown;
    mapName?: unknown;
  };
};

export interface UseFetchMeParams {
  apiBase: string;
  localPosRef: React.MutableRefObject<{ id: string; x?: number; y?: number }>;
  setMe: React.Dispatch<
    React.SetStateAction<{
      id: string;
      email: string;
      name?: string;
      onboardingCompleted?: boolean;
      role?: string;
      emailVerified?: boolean;
    } | null>
  >;
  setIsInternalOwner: React.Dispatch<React.SetStateAction<boolean>>;
  setCapabilities: React.Dispatch<React.SetStateAction<AdminCapabilities>>;
  setPositionReady: React.Dispatch<React.SetStateAction<boolean>>;
  setAuthChecked: React.Dispatch<React.SetStateAction<boolean>>;
  // True while the boot auth-check is stuck on a transient network/5xx error.
  // Lets the UI show a quiet offline hint instead of redirecting to login.
  setAuthOffline: React.Dispatch<React.SetStateAction<boolean>>;
  refetchTrigger?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Outcome of a single /auth/me probe. */
export type FetchMeOutcome =
  | { status: 'ok'; user: MeResponse }
  | { status: 'unauthorized' }
  | { status: 'network-error' };

/** Options controlling the boot-time retry policy for transient failures. */
export interface FetchMeRetryOptions {
  maxAttempts: number;
  backoff: BackoffOptions;
}

// A logged-out session answers 401/403 authoritatively and must never be
// retried. Transient conditions (server unreachable during a deploy rollover,
// 5xx, 408, 429) are retried with capped exponential backoff so a brief outage
// never drops the user to the login screen.
const AUTH_BOOT_RETRY: FetchMeRetryOptions = {
  maxAttempts: 8,
  backoff: { baseDelayMs: 300, maxDelayMs: 30_000, jitterMs: 250 },
};

function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/** Probe /auth/me once and classify the result without any retry. */
export async function fetchMeOnce(apiBase: string): Promise<FetchMeOutcome> {
  try {
    const res = await fetch(`${apiBase}/auth/me`, { credentials: 'include' });
    if (res.ok) return { status: 'ok', user: (await res.json()) as MeResponse };
    if (isTransientStatus(res.status)) return { status: 'network-error' };
    // 401/403 (and any other non-transient 4xx) are authoritative: not logged in.
    return { status: 'unauthorized' };
  } catch (e) {
    logger.debug('[WorldApp] /auth/me network error', e);
    return { status: 'network-error' };
  }
}

function applyCapabilities(user: MeResponse, setCapabilities: UseFetchMeParams['setCapabilities']) {
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
  } catch (e) {
    logger.debug('[WorldApp] Failed to set capabilities', e);
  }
}

function applyPosition(
  user: MeResponse,
  pos: { x: number; y: number } | null,
  localPosRef: UseFetchMeParams['localPosRef'],
) {
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    try {
      localPosRef.current = { id: user.id, x: pos.x, y: pos.y };
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
    try {
      window.initialPlayerPosition = { x: pos.x, y: pos.y };
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
  }
}

async function resolvePosition(
  user: MeResponse,
  apiBase: string,
  localPosRef: UseFetchMeParams['localPosRef'],
): Promise<MeResponse> {
  const lp = user.lastPosition;
  if (lp && typeof lp.x === 'number' && typeof lp.y === 'number') {
    applyPosition(user, { x: lp.x, y: lp.y }, localPosRef);
    return user;
  }
  const posBackoff = [150, 300, 600, 1200];
  let current = user;
  for (let i = 0; i < posBackoff.length; i++) {
    await sleep(posBackoff[i]);
    try {
      const res = await fetch(`${apiBase}/auth/me`, { credentials: 'include' });
      if (res.ok) {
        const next = (await res.json()) as MeResponse;
        current = next;
        const nlp = next.lastPosition;
        if (nlp && typeof nlp.x === 'number' && typeof nlp.y === 'number') {
          applyPosition(next, { x: nlp.x, y: nlp.y }, localPosRef);
          return current;
        }
      }
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
  }
  return current;
}

async function restoreMapName(user: MeResponse) {
  try {
    const lastMap = user.lastPosition?.mapName;
    if (lastMap && typeof lastMap === 'string') {
      const { useMapStore } = await import('../../../state/mapStore');
      useMapStore.getState().setCurrentMapName(lastMap);
    }
  } catch {}
}

function buildMeState(user: MeResponse) {
  return {
    id: user.id,
    email: user.email,
    ...(user.name !== undefined && { name: user.name }),
    ...(user.onboardingCompleted !== undefined && { onboardingCompleted: user.onboardingCompleted }),
    ...(user.role !== undefined && { role: user.role }),
    ...(user.emailVerified !== undefined && { emailVerified: user.emailVerified }),
  };
}

async function applyMe(user: MeResponse, params: UseFetchMeParams): Promise<void> {
  const { apiBase, localPosRef, setMe, setIsInternalOwner, setCapabilities, setPositionReady } = params;
  // Set the authoritative Colyseus room-partition tenant BEFORE any world join.
  setAuthTenantSlug(user.tenantSlug ?? null);
  try {
    setIsInternalOwner(!!user.isInternalOwner);
  } catch (e) {
    logger.debug('[WorldApp] Operation failed', e);
  }
  applyCapabilities(user, setCapabilities);
  if (user.avatarId) {
    try {
      localStorage.setItem('avatarId', user.avatarId);
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
  }
  const resolved = await resolvePosition(user, apiBase, localPosRef);
  await restoreMapName(resolved);
  setMe(buildMeState(resolved));
  setPositionReady(true);
}

/** Cancellation handle so a superseded/unmounted run stops touching state. */
export interface FetchMeControl {
  cancelled: boolean;
}

export async function runFetchMe(
  params: UseFetchMeParams,
  control: FetchMeControl = { cancelled: false },
  retry: FetchMeRetryOptions = AUTH_BOOT_RETRY,
): Promise<void> {
  const { setMe, setAuthChecked, setAuthOffline, setPositionReady } = params;
  // Network errors never end the loop: an outage longer than the backoff
  // ramp (e.g. a deploy rollover) must not strand the user on a dead
  // offline screen. maxAttempts only caps the backoff growth; from there
  // on the check keeps polling at the max delay until the server answers
  // (ok/unauthorized) or the run is cancelled.
  for (let attempt = 1; ; attempt++) {
    const outcome = await fetchMeOnce(params.apiBase);
    if (control.cancelled) return;

    if (outcome.status === 'ok') {
      setAuthOffline(false);
      try {
        await applyMe(outcome.user, params);
      } catch (e) {
        // A 200 that fails to enrich (position/map lookups) still means the
        // user is authenticated: keep them logged in with minimal state rather
        // than bouncing to login.
        logger.debug('[WorldApp] applyMe failed', e);
        setMe(buildMeState(outcome.user));
        setPositionReady(true);
      }
      if (!control.cancelled) setAuthChecked(true);
      return;
    }

    if (outcome.status === 'unauthorized') {
      setAuthOffline(false);
      setAuthTenantSlug(null);
      setMe(null);
      setAuthChecked(true);
      return;
    }

    // network-error: hold the last known state, surface the offline hint and
    // retry with backoff. We deliberately do NOT setMe(null) or setAuthChecked,
    // so the boot gate shows the offline screen instead of the login page.
    setAuthOffline(true);
    await sleep(computeBackoffDelayMs(Math.min(attempt, retry.maxAttempts), retry.backoff));
    if (control.cancelled) return;
  }
}

export function useFetchMe(params: UseFetchMeParams) {
  const { apiBase, refetchTrigger = 0 } = params;
  useEffect(() => {
    const control: FetchMeControl = { cancelled: false };
    void runFetchMe(params, control);
    return () => {
      control.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: refetch only on apiBase or explicit trigger; params shape is stable
  }, [apiBase, refetchTrigger]);

  return null;
}
