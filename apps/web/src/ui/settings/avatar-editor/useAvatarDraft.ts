import React from 'react';
import { canonicalConfig, type AvatarConfig, type SpriteCatalog } from '@meetropolis/shared';
import { getApiBaseFromWindow } from '../../../lib/apiBase';
import { logger } from '../../../lib/logger';
import type { AvatarManifest } from '../../../game/avatarRegistry';
import { initialConfig } from './slotConfig';

interface ComposeResponse {
  avatarId: string;
  manifest: AvatarManifest;
}

export type AvatarSavedHandler = (avatarId: string, manifest: AvatarManifest) => void;

export interface AvatarDraft {
  config: AvatarConfig | null;
  setConfig: (config: AvatarConfig) => void;
  save: () => void;
  saving: boolean;
  status: string | null;
  /** The saved recipe is loading; saving is disabled. */
  loading: boolean;
  /** Load error; without a saved recipe the editor remains unusable. */
  loadError: Error | null;
}

/** The adopted draft; the catalog object binds it to its catalog. */
interface DraftConfig {
  catalog: SpriteCatalog;
  config: AvatarConfig;
}

/** Load result; it applies to the catalog and the API base of the load. */
interface LoadResult {
  catalog: SpriteCatalog;
  apiBase: string;
  error: Error | null;
}

/** Load error with a safe HTTP status: no payload and no secrets. */
class AvatarLoadError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Avatar draft could not be loaded (HTTP ${status}).`);
    this.name = 'AvatarLoadError';
    this.status = status;
  }
}

/**
 * Loads the saved recipe. 404 means there is no saved
 * avatar. Other HTTP, JSON and network errors are thrown as Error
 * passed on so that they remain visible.
 */
async function fetchStoredRecipe(
  catalog: SpriteCatalog,
  apiBase: string,
  signal: AbortSignal,
): Promise<AvatarConfig | null> {
  const res = await fetch(`${apiBase}/me/avatar/custom`, { credentials: 'include', signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new AvatarLoadError(res.status);
  const data = (await res.json()) as { config?: Record<string, string> };
  const base = initialConfig(catalog);
  return canonicalConfig(catalog, { ...base, ...data.config });
}

/**
 * Loads the saved recipe and reports load state and errors. The result
 * is only adopted if nobody has edited since the load started
 * has; aborted and superseded loads no longer change any state.
 */
function useStoredRecipe(
  catalog: SpriteCatalog | null,
  apiBase: string,
  editCounter: React.RefObject<number>,
  adopt: (config: AvatarConfig) => void,
): { loading: boolean; error: Error | null } {
  const [result, setResult] = React.useState<LoadResult | null>(null);
  /** Load counter: superseded responses are discarded. */
  const loadCounter = React.useRef(0);

  React.useEffect(() => {
    if (!catalog) return;
    const controller = new AbortController();
    const loadId = ++loadCounter.current;
    const editsAtStart = editCounter.current;
    // Aborted and superseded loads must no longer change any state.
    const stale = () => controller.signal.aborted || loadId !== loadCounter.current;

    void (async () => {
      try {
        const stored = await fetchStoredRecipe(catalog, apiBase, controller.signal);
        if (stale()) return;
        if (stored !== null && editCounter.current === editsAtStart) adopt(stored);
        setResult({ catalog, apiBase, error: null });
      } catch (err) {
        if (stale()) return;
        const error = err instanceof Error ? err : new Error(String(err));
        logger.warn('[AvatarEditor] Draft could not be loaded:', error.message);
        setResult({ catalog, apiBase, error });
      }
    })();

    return () => controller.abort();
  }, [catalog, apiBase, editCounter, adopt]);

  const current = result?.catalog === catalog && result?.apiBase === apiBase;
  const loading = catalog !== null && !current;
  const error = current ? result.error : null;
  return { loading, error };
}

/**
 * The editor working draft: immediately a valid base draft from the
 * catalog, then the real saved recipe. Saving happens by the
 * server composes the sheet once (response: avatarId + manifest).
 */
export function useAvatarDraft(catalog: SpriteCatalog | null, onSaved: AvatarSavedHandler): AvatarDraft {
  const apiBase = getApiBaseFromWindow();
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<DraftConfig | null>(null);
  /** Monotonic counter of user changes; only setConfig increments it. */
  const editCounter = React.useRef(0);

  const adopt = React.useCallback(
    (stored: AvatarConfig) => {
      if (!catalog) return;
      setDraft({ catalog, config: stored });
    },
    [catalog],
  );

  const { loading, error: loadError } = useStoredRecipe(catalog, apiBase, editCounter, adopt);

  const base = React.useMemo(() => (catalog ? initialConfig(catalog) : null), [catalog]);
  const config = draft && draft.catalog === catalog ? draft.config : base;

  const setConfig = React.useCallback(
    (next: AvatarConfig) => {
      if (!catalog) return;
      editCounter.current += 1;
      setDraft({ catalog, config: next });
      // A new change invalidates the previously reported saved state.
      setStatus(null);
    },
    [catalog],
  );

  const save = React.useCallback(() => {
    if (!config || loading || loadError || saving) return;
    const snapshot = config;
    const editsAtSave = editCounter.current;
    setSaving(true);
    setStatus(null);
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/me/avatar/compose`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshot),
        });
        if (!res.ok) {
          setStatus('Speichern fehlgeschlagen.');
          return;
        }
        const data = (await res.json()) as ComposeResponse;
        onSaved(data.avatarId, data.manifest);
        // Only report if nothing has changed since saving.
        if (editCounter.current === editsAtSave) setStatus('Avatar gespeichert.');
      } catch (err) {
        logger.warn('[AvatarEditor] save failed', err);
        setStatus('Speichern fehlgeschlagen.');
      } finally {
        setSaving(false);
      }
    })();
  }, [config, apiBase, onSaved, loading, loadError, saving]);

  return { config, setConfig, save, saving, status, loading, loadError };
}
