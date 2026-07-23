import React from 'react';
import type { AvatarConfig, SpriteCatalog } from '@meetropolis/shared';
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
}

/**
 * The editor's working config: seeded from the catalog, prefilled with the
 * user's stored custom avatar for re-edit, and saved by letting the server
 * composite the sheet once (it returns the avatarId + manifest).
 */
export function useAvatarDraft(catalog: SpriteCatalog | null, onSaved: AvatarSavedHandler): AvatarDraft {
  const apiBase = getApiBaseFromWindow();
  const [config, setConfig] = React.useState<AvatarConfig | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!catalog || config) return;
    const base = initialConfig(catalog);
    setConfig(base);
    void fetch(`${apiBase}/me/avatar/custom`, { credentials: 'include' })
      .then((res) => (res.ok ? (res.json() as Promise<{ config?: Record<string, string> }>) : null))
      .then((data) => {
        if (data?.config) setConfig({ ...base, ...data.config });
      })
      .catch(() => {});
  }, [catalog, config, apiBase]);

  const save = React.useCallback(() => {
    if (!config) return;
    setSaving(true);
    setStatus(null);
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/me/avatar/compose`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        });
        if (!res.ok) {
          setStatus('Speichern fehlgeschlagen.');
          return;
        }
        const data = (await res.json()) as ComposeResponse;
        onSaved(data.avatarId, data.manifest);
        setStatus('Avatar gespeichert.');
      } catch (err) {
        logger.warn('[AvatarEditor] save failed', err);
        setStatus('Speichern fehlgeschlagen.');
      } finally {
        setSaving(false);
      }
    })();
  }, [config, apiBase, onSaved]);

  return { config, setConfig, save, saving, status };
}
