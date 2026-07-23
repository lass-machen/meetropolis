import React from 'react';
import { Button, Tabs } from '../../system';
import type { TabItem } from '../../system';
import { useSpriteCatalog } from './useSpriteCatalog';
import { useAvatarDraft, type AvatarSavedHandler } from './useAvatarDraft';
import { EDITOR_TABS } from './editorLayout';
import { SlotPicker } from './SlotPicker';
import { AvatarLivePreview } from './AvatarLivePreview';
import './avatarEditor.css';

const TAB_ITEMS: TabItem[] = EDITOR_TABS.map((tab) => ({ key: tab.key, label: tab.label }));

/**
 * In-app avatar editor: category tabs over a large live preview and a grid of
 * graphical option tiles. Preview and tiles both render through the shared
 * composer, so every tile is a literal preview of what a click stores.
 */
export function AvatarEditor({ onSaved }: { onSaved: AvatarSavedHandler }) {
  const { catalog, loading, error } = useSpriteCatalog();
  const { config, setConfig, save, saving, status } = useAvatarDraft(catalog, onSaved);
  const [tab, setTab] = React.useState(EDITOR_TABS[0].key);

  // The draft config is seeded an effect AFTER the catalog resolves, so `loading`
  // is already false while `config` is still null. Only a real failure is an
  // empty state; everything else is still loading.
  if (error !== null) return <div style={styles.info}>Editor nicht verfügbar.</div>;
  if (loading || !catalog || !config) return <div style={styles.info}>Lade Editor…</div>;

  return (
    <div>
      <Tabs items={TAB_ITEMS} activeKey={tab} onChange={setTab} style={{ marginBottom: 16 }} />
      <div className="av-ed">
        <div className="av-ed__preview">
          <AvatarLivePreview catalog={catalog} config={config} />
          <Button variant="primary" className="av-ed__save" onClick={save} disabled={saving}>
            {saving ? 'Speichert…' : 'Avatar speichern'}
          </Button>
          {status && <p className="av-ed__status">{status}</p>}
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
