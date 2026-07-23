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
};

export function useApiTokensLoader({ apiBase, open, setFreshToken, setApiTokens }: UseApiTokensLoaderParams) {
  React.useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        setFreshToken(null);
        const res = await fetch(`${apiBase}/api-tokens`, { credentials: 'include' });
        if (res.ok) setApiTokens((await res.json()) as ApiTokenSummary[]);
      } catch {}
    })();
  }, [open, apiBase, setFreshToken, setApiTokens]);
}
