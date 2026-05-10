import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Tabs } from '../../../ui/system';
import type { TabItem } from '../../../ui/system';
import { ProfileSettings } from '../../../ui/settings/ProfileSettings';
import { TenantSettings } from '../../../ui/settings/TenantSettings';
import { useTenantSettings } from '../../../ui/settings/hooks/useTenantSettings';
import { SessionManagement } from '../../../ui/settings/SessionManagement';
import { ApiTokensOverlay } from '../../../ui/admin/ApiTokensOverlay';
import { getEnterpriseWebModule } from '../../../lib/enterpriseWebLoader';

type BillingDashboardProps = { activeTab: string; onTabChange: (k: string) => void; onClose: () => void };

const BillingFallback: React.ComponentType<BillingDashboardProps> = () => (
  <div style={{ padding: 24, color: '#666' }}>
    Billing is an enterprise feature and is not available in the OSS edition.
  </div>
);

const BillingDashboardLazy = React.lazy<React.ComponentType<BillingDashboardProps>>(async () => {
  const mod = await getEnterpriseWebModule();
  if (!mod) return { default: BillingFallback };
  return { default: mod.BillingDashboard as React.ComponentType<BillingDashboardProps> };
});

interface WorldModalsProps {
  apiBase: string;
  colyseusRef?: React.RefObject<any>;

  // Profile Settings Modal
  profileOpen: boolean;
  setProfileOpen: (open: boolean) => void;

  // Billing Dashboard Modal
  billingOpen: boolean;
  setBillingOpen: (open: boolean) => void;

  // Tenant Settings Modal
  tenantSettingsOpen: boolean;
  setTenantSettingsOpen: (open: boolean) => void;
  tenantTab: string;
  setTenantTab: (tab: string) => void;

  // Session Management Modal
  sessionsOpen: boolean;
  setSessionsOpen: (open: boolean) => void;

  // API Tokens Modal
  apiModalOpen: boolean;
  setApiModalOpen: (open: boolean) => void;
  apiTokens: { id: string; name?: string | null; createdAt: string; lastUsedAt?: string | null }[];
  setApiTokens: (tokens: { id: string; name?: string | null; createdAt: string; lastUsedAt?: string | null }[]) => void;
  newTokenName: string;
  setNewTokenName: (name: string) => void;
  freshToken: string | null;
  setFreshToken: (token: string | null) => void;
}

function BillingModal({
  open,
  setOpen,
  t,
  billingTab,
  setBillingTab,
  items,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  t: (k: string) => string;
  billingTab: string;
  setBillingTab: (k: string) => void;
  items: TabItem[];
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setBillingTab('overview');
      }}
      title={t('modal.billingTitle')}
      maxWidth={900}
      minHeight={520}
      accessories={<Tabs items={items} activeKey={billingTab} onChange={setBillingTab} />}
    >
      <React.Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
        <BillingDashboardLazy activeTab={billingTab} onTabChange={setBillingTab} onClose={() => setOpen(false)} />
      </React.Suspense>
    </Modal>
  );
}

function TenantSettingsModal({
  open,
  setOpen,
  t,
  tab,
  setTab,
  items,
  apiBase,
  tenantSettings,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  t: (k: string) => string;
  tab: string;
  setTab: (k: string) => void;
  items: TabItem[];
  apiBase: string;
  tenantSettings: ReturnType<typeof useTenantSettings>;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTab('general');
      }}
      title={t('modal.orgTitle')}
      maxWidth={800}
      minHeight={520}
      accessories={<Tabs items={items} activeKey={tab} onChange={setTab} />}
    >
      <TenantSettings
        activeTab={tab}
        onTabChange={setTab}
        onClose={() => setOpen(false)}
        apiBase={apiBase}
        settingsData={tenantSettings}
      />
    </Modal>
  );
}

export function WorldModals(props: WorldModalsProps) {
  const {
    apiBase,
    colyseusRef,
    profileOpen,
    setProfileOpen,
    billingOpen,
    setBillingOpen,
    tenantSettingsOpen,
    setTenantSettingsOpen,
    tenantTab,
    setTenantTab,
    sessionsOpen,
    setSessionsOpen,
    apiModalOpen,
    setApiModalOpen,
    apiTokens,
    setApiTokens,
    newTokenName,
    setNewTokenName,
    freshToken,
    setFreshToken,
  } = props;
  const { t } = useTranslation();

  const [billingTab, setBillingTab] = useState('overview');
  const billingTabItems: TabItem[] = [
    { key: 'overview', label: t('billing.tabOverview') },
    { key: 'invoices', label: t('billing.tabInvoices') },
    { key: 'plans', label: t('billing.tabPlans') },
  ];

  const tenantSettings = useTenantSettings();

  React.useEffect(() => {
    if (tenantSettingsOpen) {
      void tenantSettings.fetchData();
    }
  }, [tenantSettingsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const tenantTabItems: TabItem[] = [
    { key: 'general', label: t('tenant.tabGeneral') },
    { key: 'members', label: `${t('tenant.tabMembers')} (${tenantSettings.members.length})` },
    { key: 'invites', label: t('tenant.tabInvites') },
    ...(tenantSettings.isEnterprise
      ? [{ key: 'guests', label: `${t('tenant.tabGuests')} (${tenantSettings.guests.length})` }]
      : []),
  ];

  return (
    <>
      <Modal
        open={profileOpen}
        onOpenChange={setProfileOpen}
        title={t('modal.profileTitle')}
        maxWidth={700}
        minHeight={520}
      >
        <ProfileSettings onClose={() => setProfileOpen(false)} colyseusRef={colyseusRef} />
      </Modal>

      <BillingModal
        open={billingOpen}
        setOpen={setBillingOpen}
        t={t}
        billingTab={billingTab}
        setBillingTab={setBillingTab}
        items={billingTabItems}
      />

      <TenantSettingsModal
        open={tenantSettingsOpen}
        setOpen={setTenantSettingsOpen}
        t={t}
        tab={tenantTab}
        setTab={setTenantTab}
        items={tenantTabItems}
        apiBase={apiBase}
        tenantSettings={tenantSettings}
      />

      <Modal
        open={sessionsOpen}
        onOpenChange={setSessionsOpen}
        title={t('modal.sessionsTitle')}
        maxWidth={700}
        minHeight={520}
      >
        <SessionManagement onClose={() => setSessionsOpen(false)} />
      </Modal>

      <ApiTokensOverlay
        open={apiModalOpen}
        onClose={() => setApiModalOpen(false)}
        apiBase={apiBase}
        apiTokens={apiTokens}
        setApiTokens={setApiTokens}
        newTokenName={newTokenName}
        setNewTokenName={setNewTokenName}
        freshToken={freshToken}
        setFreshToken={setFreshToken}
      />
    </>
  );
}
