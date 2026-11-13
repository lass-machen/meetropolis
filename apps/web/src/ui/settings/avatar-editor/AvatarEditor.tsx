import React from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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

  // The base draft follows immediately from the catalog; `config` is only null,
  // as long as the catalog itself is missing. An error while loading the saved
  // recipe leaves the editor unusable: there is no honest
  // fallback draft to save with.
  if (error !== null || loadError !== null) return <div style={styles.info}>{t('avatarEditor.unavailable')}</div>;
  if (loading || !catalog || !config) return <div style={styles.info}>{t('avatarEditor.loading')}</div>;

  return (
    <div>
      <Tabs items={TAB_ITEMS} activeKey={tab} onChange={setTab} style={{ marginBottom: 16 }} />
      <div className="av-ed">
        <div className="av-ed__preview">
          <AvatarLivePreview catalog={catalog} config={config} />
          <Button variant="primary" className="av-ed__save" onClick={save} disabled={saving || draftLoading}>
            {saving ? t('avatarEditor.saving') : t('avatarEditor.save')}
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
