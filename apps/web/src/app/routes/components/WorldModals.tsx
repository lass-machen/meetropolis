import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Tabs } from '../../../ui/system';
import type { TabItem } from '../../../ui/system';
import { ProfileSettings } from '../../../ui/settings/ProfileSettings';
import { BillingDashboard } from '../../../ui/billing/BillingDashboard';
import { TenantSettings } from '../../../ui/settings/TenantSettings';
import { useTenantSettings } from '../../../ui/settings/hooks/useTenantSettings';
import { SessionManagement } from '../../../ui/settings/SessionManagement';
import { ApiTokensOverlay } from '../../../ui/admin/ApiTokensOverlay';

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

export function WorldModals({
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
}: WorldModalsProps) {
  const { t } = useTranslation();

  // Billing tab state
  const [billingTab, setBillingTab] = useState('overview');
  const billingTabItems: TabItem[] = [
    { key: 'overview', label: t('billing.tabOverview') },
    { key: 'invoices', label: t('billing.tabInvoices') },
    { key: 'plans', label: t('billing.tabPlans') },
  ];

  // Tenant settings hook for dynamic tab labels
  const tenantSettings = useTenantSettings();

  React.useEffect(() => {
    if (tenantSettingsOpen) {
      tenantSettings.fetchData();
    }
  }, [tenantSettingsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const tenantTabItems: TabItem[] = [
    { key: 'general', label: t('tenant.tabGeneral') },
    { key: 'members', label: `${t('tenant.tabMembers')} (${tenantSettings.members.length})` },
    { key: 'invites', label: t('tenant.tabInvites') },
    ...(tenantSettings.isEnterprise ? [{ key: 'guests', label: `${t('tenant.tabGuests')} (${tenantSettings.guests.length})` }] : []),
  ];

  return (
    <>
      {/* Profile Settings Modal */}
      <Modal open={profileOpen} onOpenChange={setProfileOpen} title={t('modal.profileTitle')} maxWidth={700} minHeight={520}>
        <ProfileSettings onClose={() => setProfileOpen(false)} colyseusRef={colyseusRef} />
      </Modal>

      {/* Billing Dashboard Modal */}
      <Modal
        open={billingOpen}
        onOpenChange={(open) => {
          setBillingOpen(open);
          if (!open) setBillingTab('overview');
        }}
        title={t('modal.billingTitle')}
        maxWidth={900}
        minHeight={520}
        accessories={<Tabs items={billingTabItems} activeKey={billingTab} onChange={setBillingTab} />}
      >
        <BillingDashboard activeTab={billingTab} onTabChange={setBillingTab} onClose={() => setBillingOpen(false)} />
      </Modal>

      {/* Tenant/Organization Settings Modal */}
      <Modal
        open={tenantSettingsOpen}
        onOpenChange={(open) => {
          setTenantSettingsOpen(open);
          if (!open) setTenantTab('general');
        }}
        title={t('modal.orgTitle')}
        maxWidth={800}
        minHeight={520}
        accessories={<Tabs items={tenantTabItems} activeKey={tenantTab} onChange={setTenantTab} />}
      >
        <TenantSettings activeTab={tenantTab} onTabChange={setTenantTab} onClose={() => setTenantSettingsOpen(false)} apiBase={apiBase} settingsData={tenantSettings} />
      </Modal>

      {/* Session Management Modal */}
      <Modal
        open={sessionsOpen}
        onOpenChange={setSessionsOpen}
        title={t('modal.sessionsTitle')}
        maxWidth={700}
        minHeight={520}
      >
        <SessionManagement onClose={() => setSessionsOpen(false)} />
      </Modal>

      {/* API Token Modal */}
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
