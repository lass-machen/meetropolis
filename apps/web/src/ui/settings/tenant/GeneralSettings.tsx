import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TenantInfo } from './types';
import { Section, DescriptionList, Button, Input, NavBar, Select } from '../../system';
import { ChevronLeftIcon } from '../../system/NavBar';
import type { DescriptionItem } from '../../system';

interface GeneralSettingsProps {
  tenant: TenantInfo;
  saving: boolean;
  apiBase: string;
  onUpdateTenant: (data: { name?: string; defaultMapName?: string }) => Promise<boolean>;
  onSuccess: (msg: string | null) => void;
  memberCount?: number;
  guestCount?: number | undefined;
}

type Screen = { type: 'view' } | { type: 'edit' };

export function GeneralSettings({ tenant, saving, apiBase, onUpdateTenant, onSuccess, memberCount, guestCount }: GeneralSettingsProps) {
  const { t } = useTranslation();
  const [screen, setScreen] = React.useState<Screen>({ type: 'view' });
  const [editName, setEditName] = React.useState('');
  const [editDefaultMap, setEditDefaultMap] = React.useState('');
  const [availableMaps, setAvailableMaps] = React.useState<{ id: string; name: string }[]>([]);

  async function startEdit() {
    setEditName(tenant.name);
    setEditDefaultMap(tenant.defaultMapName || 'office');
    setScreen({ type: 'edit' });
    // Load available maps
    try {
      const res = await fetch(`${apiBase}/maps`, { credentials: 'include' });
      if (res.ok) {
        const maps = await res.json();
        setAvailableMaps(maps.map((m: any) => ({ id: m.id, name: m.name })));
      }
    } catch { /* ignore */ }
  }

  async function saveEdit() {
    const success = await onUpdateTenant({
      name: editName,
      defaultMapName: editDefaultMap,
    });
    if (success) {
      setScreen({ type: 'view' });
      onSuccess(t('tenant.updateSuccess'));
    }
  }

  if (screen.type === 'edit') {
    return (
      <>
        <NavBar
          left={<Button iconOnly size="sm" variant="ghost" onClick={() => setScreen({ type: 'view' })}><ChevronLeftIcon /></Button>}
          title={t('tenant.editOrg')}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--fg)' }}>{t('tenant.name')}</label>
            <Input value={editName} onChange={e => setEditName(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--fg)' }}>{t('tenant.defaultMap')}</label>
            <Select
              value={editDefaultMap}
              onChange={setEditDefaultMap}
              options={availableMaps.map(m => ({ value: m.name, label: m.name }))}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button variant="primary" onClick={saveEdit} disabled={saving}>{t('tenant.saveMember')}</Button>
            <Button variant="ghost" onClick={() => setScreen({ type: 'view' })}>{t('tenant.cancelEdit')}</Button>
          </div>
        </div>
      </>
    );
  }

  // View screen
  const items: DescriptionItem[] = [
    { label: t('tenant.name'), value: tenant.name },
    { label: t('tenant.subdomain'), value: tenant.slug },
    { label: t('tenant.seatLimit'), value: tenant.bypassLimits ? t('tenant.unlimited') : t('tenant.usersCount', { count: tenant.freeSeats + tenant.concurrentLimit }) },
    { label: t('tenant.createdAt'), value: new Date(tenant.createdAt).toLocaleDateString() },
    { label: t('tenant.memberCount'), value: String(memberCount ?? tenant.memberCount ?? 0) },
    ...(guestCount !== undefined ? [{ label: t('tenant.tabGuests'), value: String(guestCount) }] : []),
    { label: t('tenant.defaultMap'), value: tenant.defaultMapName || 'office' },
  ];

  return (
    <Section title={t('tenant.orgInfo')} actions={<Button size="sm" variant="secondary" onClick={startEdit}>{t('tenant.editOrg')}</Button>}>
      <DescriptionList items={items} />
    </Section>
  );
}
