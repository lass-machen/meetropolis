import React from 'react';
import { Button, Input, Checkbox, FieldRow } from '../system';
import { logger } from '../../lib/logger';

type Settings = {
  publicRegistrationEnabled: boolean;
  defaultFreeSeats: number;
};

function useSettingsAdminState(apiBase: string) {
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
      setError('Einstellungen konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

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
      setError('Einstellungen konnten nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  }, [apiBase, settings]);

  return { settings, setSettings, loading, saving, error, success, save };
}

export function SettingsAdmin(props: { apiBase: string }) {
  const { settings, setSettings, loading, saving, error, success, save } = useSettingsAdminState(props.apiBase);

  if (loading) return <div>Lade Einstellungen…</div>;
  if (!settings) return <div>{error || 'Keine Einstellungen verfügbar.'}</div>;

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 600 }}>
      <FieldRow
        label="Öffentliche Registrierung erlauben"
        hint="Wenn aktiviert, können sich neue Mandanten über die öffentliche Registrierungsseite selbst registrieren."
        control={
          <Checkbox
            checked={settings.publicRegistrationEnabled}
            onChange={(e) => setSettings({ ...settings, publicRegistrationEnabled: e.target.checked })}
          />
        }
      />

      <FieldRow
        label="Standard Free Seats"
        hint="Anzahl der kostenlosen Plätze, die neuen Mandanten standardmäßig zugewiesen werden."
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
          {saving ? 'Speichere…' : 'Speichern'}
        </Button>
        {error && <span style={{ color: 'var(--red, #ed4245)', fontSize: 13 }}>{error}</span>}
        {success && <span style={{ color: 'var(--green, #3ba55d)', fontSize: 13 }}>Gespeichert!</span>}
      </div>
    </div>
  );
}
