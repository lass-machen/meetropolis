import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { fetchApiTokens, useApiTokensLoader, type ApiTokenSummary, type ApiTokensLoadState } from './useApiTokens';

interface CreateTokenResponse {
  token: string;
}

export type UseApiTokenActionsParams = {
  open: boolean;
  apiBase: string;
  newTokenName: string;
  setApiTokens: (v: ApiTokenSummary[]) => void;
  setNewTokenName: (v: string) => void;
  setFreshToken: (v: string | null) => void;
};

/**
 * State and actions behind the API tokens overlay: the single load on open,
 * create, delete with an inline confirmation, and the cleanup on close.
 */
export function useApiTokenActions(params: UseApiTokenActionsParams) {
  const { open, apiBase, newTokenName, setApiTokens, setNewTokenName, setFreshToken } = params;
  const { t } = useTranslation();
  const [error, setError] = React.useState<string | null>(null);
  const [listState, setListState] = React.useState<ApiTokensLoadState>('loading');
  // Row waiting for its second click. An in-app confirmation: the desktop
  // shell's WebView has no usable window.confirm.
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);
  // Bumped on every close. A request that started before the close compares
  // its own generation on return and drops its result, so a late reply cannot
  // put a secret or a list back into state that was just cleared.
  const generationRef = React.useRef(0);

  // The single place that loads the list on open; it also resets the fresh token.
  useApiTokensLoader({
    apiBase,
    open,
    setFreshToken,
    setApiTokens,
    onLoadState: (state) => {
      setListState(state);
      setError(state === 'failed' ? t('admin.api.loadError') : null);
    },
  });

  // Closing drops the secret, the list and the half-typed name, so none of it
  // is rendered again on the next open (or by the next user after a re-login).
  // The setters are listed as dependencies on purpose: they are the stable
  // useState setters of WorldApp. A caller passing unstable functions would
  // run this cleanup on every render and wipe the state.
  React.useEffect(() => {
    if (!open) return;
    return () => {
      generationRef.current += 1;
      setFreshToken(null);
      setApiTokens([]);
      setNewTokenName('');
      setPendingDeleteId(null);
    };
  }, [open, setFreshToken, setApiTokens, setNewTokenName]);

  // Reloads the list after a change. A failed reload empties the list and says
  // so, rather than leaving a stale or malformed one on screen.
  const refreshList = async () => {
    const generation = generationRef.current;
    try {
      const list = await fetchApiTokens(apiBase);
      if (generation !== generationRef.current) return;
      setApiTokens(list);
      setListState('loaded');
    } catch {
      if (generation !== generationRef.current) return;
      setApiTokens([]);
      setListState('failed');
      setError(t('admin.api.loadError'));
    }
  };

  // One create or delete at a time. The ref closes the gap between a click and
  // the re-render that disables the button, so a double click cannot fire twice
  // (two creates would overwrite the first secret before it was ever shown).
  const busyRef = React.useRef(false);
  const [busy, setBusy] = React.useState(false);
  const runExclusive = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const createToken = () =>
    runExclusive(async () => {
      const generation = generationRef.current;
      try {
        const res = await fetch(`${apiBase}/api-tokens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ name: newTokenName || undefined }),
        });
        if (!res.ok) throw new Error(`token creation failed with status ${res.status}`);
        const data = (await res.json()) as CreateTokenResponse;
        if (generation !== generationRef.current) return;
        setFreshToken(data.token);
        setNewTokenName('');
        await refreshList();
      } catch {
        if (generation === generationRef.current) setError(t('admin.api.createError'));
      }
    });

  const deleteToken = (id: string) => {
    setPendingDeleteId(null);
    return runExclusive(async () => {
      const generation = generationRef.current;
      try {
        const res = await fetch(`${apiBase}/api-tokens/${id}`, { method: 'DELETE', credentials: 'include' });
        await refreshList();
        if (generation !== generationRef.current) return;
        // 404 means the token is already gone, which is what the user asked for.
        if (!res.ok && res.status !== 404) setError(t('admin.api.deleteError'));
      } catch {
        if (generation === generationRef.current) setError(t('admin.api.deleteError'));
      }
    });
  };

  return { error, setError, listState, busy, pendingDeleteId, setPendingDeleteId, createToken, deleteToken };
}
