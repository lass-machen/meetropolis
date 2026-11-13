import React from 'react';
import { Button, Tabs } from '../../system';
import type { TabItem } from '../../system';
import { useSpriteCatalog } from './useSpriteCatalog';
import { useAvatarDraft, type AvatarSavedHandler } from './useAvatarDraft';
import { EDITOR_TABS } from './editorLayout';
import { SlotPicker } from './SlotPicker';
import { AvatarLivePreview } from './AvatarLivePreview';
import { AvatarStatus } from './AvatarStatus';
import './avatarEditor.css';

const TAB_ITEMS: TabItem[] = EDITOR_TABS.map((tab) => ({ key: tab.key, label: tab.label }));

/**
 * In-app avatar editor: category tabs over a large live preview and a grid of
 * graphical option tiles. Preview and tiles both render through the shared
 * composer, so every tile is a literal preview of what a click stores.
 */
export function AvatarEditor({ onSaved }: { onSaved: AvatarSavedHandler }) {
  const { catalog, loading, error } = useSpriteCatalog();
  const {
    config,
    setConfig,
    save,
    saving,
    status,
    loading: draftLoading,
    loadError,
  } = useAvatarDraft(catalog, onSaved);
  const [tab, setTab] = React.useState(EDITOR_TABS[0].key);

  // Der Basisentwurf folgt sofort aus dem Katalog; `config` ist nur null,
  // solange der Katalog selbst fehlt. Ein Fehler beim Laden des gespeicherten
  // Rezepts macht den Editor unbrauchbar: Es gibt keinen ehrlichen
  // Ersatzentwurf zum Speichern.
  if (error !== null || loadError !== null) return <div style={styles.info}>Editor nicht verfügbar.</div>;
  if (loading || !catalog || !config) return <div style={styles.info}>Lade Editor…</div>;

  return (
    <div>
      <Tabs items={TAB_ITEMS} activeKey={tab} onChange={setTab} style={{ marginBottom: 16 }} />
      <div className="av-ed">
        <div className="av-ed__preview">
          <AvatarLivePreview catalog={catalog} config={config} />
          <Button variant="primary" className="av-ed__save" onClick={save} disabled={saving || draftLoading}>
            {saving ? 'Speichert…' : 'Avatar speichern'}
          </Button>
          <AvatarStatus status={status} />
        </div>
        <SlotPicker catalog={catalog} config={config} onChange={setConfig} tabKey={tab} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  info: { padding: 16, fontSize: 13, color: 'var(--fg-subtle, #888)' },
};

export default AvatarEditor;
