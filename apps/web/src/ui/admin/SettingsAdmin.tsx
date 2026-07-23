import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Checkbox, FieldRow } from '../system';
import { logger } from '../../lib/logger';

type Settings = {
  publicRegistrationEnabled: boolean;
  defaultFreeSeats: number;
};

function useSettingsAdminState(apiBase: string, t: (key: string) => string) {
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${apiBase}/admin/settings`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSettings((await res.json()) as Settings);
    } catch (err) {
      logger.warn('[SettingsAdmin] Failed to load settings', err);
      setError(t('admin.settings.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [apiBase, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const save = React.useCallback(async () => {
    if (!settings) return;
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);
      const res = await fetch(`${apiBase}/admin/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSettings((await res.json()) as Settings);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      logger.warn('[SettingsAdmin] Failed to save settings', err);
      setError(t('admin.settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [apiBase, settings, t]);

  return { settings, setSettings, loading, saving, error, success, save };
}

export function SettingsAdmin(props: { apiBase: string }) {
  const { t } = useTranslation();
  const { settings, setSettings, loading, saving, error, success, save } = useSettingsAdminState(props.apiBase, t);

  if (loading) return <div>{t('admin.settings.loading')}</div>;
  if (!settings) return <div>{error || t('admin.settings.notAvailable')}</div>;

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 600 }}>
      <FieldRow
        label={t('admin.settings.publicRegistration.label')}
        hint={t('admin.settings.publicRegistration.hint')}
        control={
          <Checkbox
            checked={settings.publicRegistrationEnabled}
            onChange={(e) => setSettings({ ...settings, publicRegistrationEnabled: e.target.checked })}
          />
        }
      />

      <FieldRow
        label={t('admin.settings.defaultFreeSeats.label')}
        hint={t('admin.settings.defaultFreeSeats.hint')}
        control={
          <Input
            type="number"
            value={settings.defaultFreeSeats}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setSettings({ ...settings, defaultFreeSeats: Number(e.target.value) || 0 })
            }
            style={{ width: 100 }}
          />
        }
      />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button
          onClick={() => {
            void save();
          }}
          variant="primary"
        >
          {saving ? t('admin.settings.saving') : t('admin.settings.save')}
        </Button>
        {error && <span style={{ color: 'var(--red, #ed4245)', fontSize: 13 }}>{error}</span>}
        {success && <span style={{ color: 'var(--green, #3ba55d)', fontSize: 13 }}>{t('admin.settings.saved')}</span>}
      </div>
    </div>
  );
}
