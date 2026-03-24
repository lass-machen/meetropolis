import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Tabs } from '../../../ui/system';
import type { TabItem } from '../../../ui/system';
import { UserManagement } from '../../../ui/admin/UserManagement';
import { ThemeToggleButton } from '../../../ui/theme';
import { ProfileSettings } from '../../../ui/settings/ProfileSettings';
import { BillingDashboard } from '../../../ui/billing/BillingDashboard';
import { TenantSettings } from '../../../ui/settings/TenantSettings';
import { useTenantSettings } from '../../../ui/settings/hooks/useTenantSettings';
import { SessionManagement } from '../../../ui/settings/SessionManagement';
import { ApiTokensOverlay } from '../../../ui/admin/ApiTokensOverlay';
import { InvitesModal } from '../../../features/admin/InvitesModal';

interface WorldModalsProps {
  apiBase: string;
  colyseusRef?: React.RefObject<any>;

  // User Management Modal
  userModalOpen: boolean;
  setUserModalOpen: (open: boolean) => void;

  // Profile Settings Modal
  profileOpen: boolean;
  setProfileOpen: (open: boolean) => void;

  // Billing Dashboard Modal
  billingOpen: boolean;
  setBillingOpen: (open: boolean) => void;

  // Tenant Settings Modal
  tenantSettingsOpen: boolean;
  setTenantSettingsOpen: (open: boolean) => void;

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

  // Invites Modal
  invitesModalOpen: boolean;
  setInvitesModalOpen: (open: boolean) => void;
}

export function WorldModals({
  apiBase,
  colyseusRef,
  userModalOpen,
  setUserModalOpen,
  profileOpen,
  setProfileOpen,
  billingOpen,
  setBillingOpen,
  tenantSettingsOpen,
  setTenantSettingsOpen,
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
  invitesModalOpen,
  setInvitesModalOpen,
}: WorldModalsProps) {
  const { t } = useTranslation();

  // Billing tab state
  const [billingTab, setBillingTab] = useState('overview');
  const billingTabItems: TabItem[] = [
    { key: 'overview', label: t('billing.tabOverview') },
    { key: 'invoices', label: t('billing.tabInvoices') },
    { key: 'plans', label: t('billing.tabPlans') },
  ];

  // Tenant settings tab state + hook for dynamic tab labels
  const [tenantTab, setTenantTab] = useState('general');
  const tenantSettings = useTenantSettings();

  React.useEffect(() => {
    if (tenantSettingsOpen) {
      tenantSettings.fetchData();
    }
  }, [tenantSettingsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const tenantTabItems: TabItem[] = [
    { key: 'general', label: t('tenant.tabGeneral') },
    { key: 'members', label: `${t('tenant.tabMembers')} (${tenantSettings.members.length})` },
    ...(tenantSettings.isEnterprise ? [{ key: 'guests', label: `${t('tenant.tabGuests')} (${tenantSettings.guests.length})` }] : []),
  ];

  return (
    <>
      {/* User Management Modal */}
      <Modal
        open={userModalOpen}
        onOpenChange={setUserModalOpen}
        title={t('modal.usersTitle')}
        maxWidth={900}
        minHeight={520}
        actions={<div style={{ display: 'flex', gap: 8 }}><ThemeToggleButton /></div>}
      >
        <UserManagement baseUrl={apiBase} onBack={() => setUserModalOpen(false)} />
      </Modal>

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
        <TenantSettings activeTab={tenantTab} onTabChange={setTenantTab} onClose={() => setTenantSettingsOpen(false)} settingsData={tenantSettings} />
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

      {/* Invites Modal */}
      <InvitesModal open={invitesModalOpen} onOpenChange={setInvitesModalOpen} apiBase={apiBase} />
    </>
  );
}
