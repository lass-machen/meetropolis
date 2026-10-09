import * as React from 'react';

type ApiTokenSummary = {
  id: string;
  name?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
};

type UseApiTokensLoaderParams = {
  apiBase: string;
  open: boolean;
  setFreshToken: (v: string | null) => void;
  setApiTokens: (list: ApiTokenSummary[]) => void;
  onLoadState: (state: ApiTokensLoadState) => void;
};

export type ApiTokensLoadState = 'loading' | 'loaded' | 'failed';

/**
 * Fetches the caller's API tokens. Rejects on a non-2xx status or a payload
 * that is not a list, so callers never hand an error object on as a token list.
 */
export async function fetchApiTokens(apiBase: string): Promise<ApiTokenSummary[]> {
  const res = await fetch(`${apiBase}/api-tokens`, { credentials: 'include' });
  if (!res.ok) throw new Error(`api-tokens request failed with status ${res.status}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error('api-tokens response is not a list');
  return body as ApiTokenSummary[];
}

export function useApiTokensLoader({
  apiBase,
  open,
  setFreshToken,
  setApiTokens,
  onLoadState,
}: UseApiTokensLoaderParams) {
  // Kept in a ref so an inline callback does not re-trigger the load on every render.
  const onLoadStateRef = React.useRef(onLoadState);
  onLoadStateRef.current = onLoadState;

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFreshToken(null);
    onLoadStateRef.current('loading');
    void (async () => {
      try {
        const list = await fetchApiTokens(apiBase);
        if (cancelled) return;
        setApiTokens(list);
        onLoadStateRef.current('loaded');
      } catch {
        if (cancelled) return;
        setApiTokens([]);
        onLoadStateRef.current('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, apiBase, setFreshToken, setApiTokens]);
}
