import { useTranslation } from 'react-i18next';
import type { TenantInfo } from './types';
import { Section, Button } from '../../system';

interface GeneralSettingsProps {
  tenant: TenantInfo;
  onNavigateToMembers: () => void;
}

export function GeneralSettings({ tenant, onNavigateToMembers }: GeneralSettingsProps) {
  const { t } = useTranslation();
  return (
    <>
      <Section title={t('tenant.orgInfo')}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: 8 }}>
            <span style={{ color: 'var(--fg-subtle, #888)', fontSize: 14 }}>{t('tenant.subdomain')}</span>
            <span style={{ color: 'var(--fg, #fff)', fontSize: 14, fontWeight: 500 }}>{tenant.slug}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: 8 }}>
            <span style={{ color: 'var(--fg-subtle, #888)', fontSize: 14 }}>{t('tenant.name')}</span>
            <span style={{ color: 'var(--fg, #fff)', fontSize: 14, fontWeight: 500 }}>{tenant.name}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: 8 }}>
            <span style={{ color: 'var(--fg-subtle, #888)', fontSize: 14 }}>{t('tenant.seatLimit')}</span>
            <span style={{ color: 'var(--fg, #fff)', fontSize: 14, fontWeight: 500 }}>
              {tenant.bypassLimits ? t('tenant.unlimited') : t('tenant.usersCount', { count: tenant.freeSeats + tenant.concurrentLimit })}
            </span>
          </div>
        </div>
      </Section>

      <Section title={t('tenant.quickActions')}>
        <div style={{ display: 'flex', gap: 12 }}>
          <Button variant="secondary" onClick={onNavigateToMembers}>
            {t('tenant.manageMembers')}
          </Button>
        </div>
      </Section>
    </>
  );
}
