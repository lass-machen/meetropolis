import { useTranslation } from 'react-i18next';
import type { TenantInfo } from './types';
import { Section, DescriptionList } from '../../system';
import type { DescriptionItem } from '../../system';

interface GeneralSettingsProps {
  tenant: TenantInfo;
}

export function GeneralSettings({ tenant }: GeneralSettingsProps) {
  const { t } = useTranslation();

  const items: DescriptionItem[] = [
    { label: t('tenant.subdomain'), value: tenant.slug },
    { label: t('tenant.name'), value: tenant.name },
    { label: t('tenant.seatLimit'), value: tenant.bypassLimits ? t('tenant.unlimited') : t('tenant.usersCount', { count: tenant.freeSeats + tenant.concurrentLimit }) },
  ];

  return (
    <Section title={t('tenant.orgInfo')}>
      <DescriptionList items={items} />
    </Section>
  );
}
