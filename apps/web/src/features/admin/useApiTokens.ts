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
  /** Called with `false` when a load starts and `true` when it fails. */
  onLoadError: (failed: boolean) => void;
};

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
  onLoadError,
}: UseApiTokensLoaderParams) {
  // Kept in a ref so an inline callback does not re-trigger the load on every render.
  const onLoadErrorRef = React.useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFreshToken(null);
    onLoadErrorRef.current(false);
    void (async () => {
      try {
        const list = await fetchApiTokens(apiBase);
        if (!cancelled) setApiTokens(list);
      } catch {
        if (cancelled) return;
        setApiTokens([]);
        onLoadErrorRef.current(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, apiBase, setFreshToken, setApiTokens]);
}
