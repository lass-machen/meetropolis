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
  /** Das gespeicherte Rezept wird gerade geladen; Speichern ist gesperrt. */
  loading: boolean;
  /** Fehler des Ladevorgangs; ohne gespeichertes Rezept bleibt der Editor unbrauchbar. */
  loadError: Error | null;
}

/** Der übernommene Entwurf; das Katalog-Objekt bindet ihn an seinen Katalog. */
interface DraftConfig {
  catalog: SpriteCatalog;
  config: AvatarConfig;
}

/** Ladeergebnis; es gilt für den Katalog und die API-Basis des Ladevorgangs. */
interface LoadResult {
  catalog: SpriteCatalog;
  apiBase: string;
  error: Error | null;
}

/** Ladefehler mit sicherem HTTP-Status: ohne Payload und ohne Secrets. */
class AvatarLoadError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Avatar-Entwurf konnte nicht geladen werden (HTTP ${status}).`);
    this.name = 'AvatarLoadError';
    this.status = status;
  }
}

/**
 * Lädt das gespeicherte Rezept. 404 heißt: es gibt noch keinen gespeicherten
 * Avatar. Andere HTTP-, JSON- und Netzwerkfehler werden als Error
 * weitergereicht, damit sie sichtbar bleiben.
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
 * Lädt das gespeicherte Rezept und meldet Ladezustand und Fehler. Das Ergebnis
 * wird nur übernommen, wenn seit Beginn des Ladevorgangs niemand bearbeitet
 * hat; abgebrochene und überholte Ladevorgänge ändern keinen Zustand mehr.
 */
function useStoredRecipe(
  catalog: SpriteCatalog | null,
  apiBase: string,
  editCounter: React.RefObject<number>,
  adopt: (config: AvatarConfig) => void,
): { loading: boolean; error: Error | null } {
  const [result, setResult] = React.useState<LoadResult | null>(null);
  /** Zähler der Ladevorgänge: überholte Antworten werden verworfen. */
  const loadCounter = React.useRef(0);

  React.useEffect(() => {
    if (!catalog) return;
    const controller = new AbortController();
    const loadId = ++loadCounter.current;
    const editsAtStart = editCounter.current;
    // Abgebrochene und überholte Ladevorgänge dürfen keinen Zustand mehr ändern.
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
        logger.warn('[AvatarEditor] Entwurf konnte nicht geladen werden:', error.message);
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
 * Der Arbeitsentwurf des Editors: sofort ein gültiger Basisentwurf aus dem
 * Katalog, danach das echte gespeicherte Rezept. Gespeichert wird, indem der
 * Server das Blatt einmal komponiert (Antwort: avatarId + Manifest).
 */
export function useAvatarDraft(catalog: SpriteCatalog | null, onSaved: AvatarSavedHandler): AvatarDraft {
  const apiBase = getApiBaseFromWindow();
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<DraftConfig | null>(null);
  /** Monotoner Zähler der Nutzeränderungen; nur setConfig erhöht ihn. */
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
      // Eine neue Änderung macht den zuvor gemeldeten Speicherstand ungültig.
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
        // Nur melden, wenn seit dem Speichern nichts geändert wurde.
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
