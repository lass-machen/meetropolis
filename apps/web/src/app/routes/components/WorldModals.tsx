import React from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../../ui/system';
import { UserManagement } from '../../../ui/admin/UserManagement';
import { ThemeToggleButton } from '../../../ui/theme';
import { ProfileSettings } from '../../../ui/settings/ProfileSettings';
import { BillingDashboard } from '../../../ui/billing/BillingDashboard';
import { TenantSettings } from '../../../ui/settings/TenantSettings';
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
  return (
    <>
      {/* User Management Modal */}
      <Modal
        open={userModalOpen}
        onOpenChange={setUserModalOpen}
        title={t('modal.usersTitle')}
        maxWidth={900}
        minHeight={520}
        right={<div style={{ display: 'flex', gap: 8 }}><ThemeToggleButton /></div>}
      >
        <UserManagement baseUrl={apiBase} onBack={() => setUserModalOpen(false)} />
      </Modal>

      {/* Profile Settings Modal */}
      <Modal open={profileOpen} onOpenChange={setProfileOpen} title={t('modal.profileTitle')} maxWidth={700} minHeight={520}>
        <ProfileSettings onClose={() => setProfileOpen(false)} colyseusRef={colyseusRef} />
      </Modal>

      {/* Billing Dashboard Modal */}
      <Modal open={billingOpen} onOpenChange={setBillingOpen} title={t('modal.billingTitle')} maxWidth={900} minHeight={520}>
        <BillingDashboard onClose={() => setBillingOpen(false)} />
      </Modal>

      {/* Tenant/Organization Settings Modal */}
      <Modal open={tenantSettingsOpen} onOpenChange={setTenantSettingsOpen} title={t('modal.orgTitle')} maxWidth={800} minHeight={520}>
        <TenantSettings onClose={() => setTenantSettingsOpen(false)} />
      </Modal>

      {/* Session Management Modal */}
      <Modal open={sessionsOpen} onOpenChange={setSessionsOpen} title={t('modal.sessionsTitle')} maxWidth={700} minHeight={520}>
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
