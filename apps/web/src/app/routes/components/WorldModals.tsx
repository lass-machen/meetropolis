import { Modal } from '../../../ui/system';
import { UserManagement } from '../../../ui/admin/UserManagement';
import { ThemeToggleButton } from '../../../ui/theme';
import { ProfileSettings } from '../../../ui/settings/ProfileSettings';
import { BillingDashboard } from '../../../ui/billing/BillingDashboard';
import { TenantSettings } from '../../../ui/settings/TenantSettings';
import { SessionManagement } from '../../../ui/settings/SessionManagement';
import { ApiTokensOverlay } from '../../../ui/admin/ApiTokensOverlay';
import { InvitesModal } from '../../../features/admin/InvitesModal';
import { TenantsAdminModal } from '../../../features/admin/TenantsAdminModal';

interface WorldModalsProps {
  apiBase: string;

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

  // Admin Modal
  adminOpen: boolean;
  setAdminOpen: (open: boolean) => void;
  isInternalOwner: boolean;
}

export function WorldModals({
  apiBase,
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
  adminOpen,
  setAdminOpen,
  isInternalOwner,
}: WorldModalsProps) {
  return (
    <>
      {/* User Management Modal */}
      <Modal
        open={userModalOpen}
        onOpenChange={setUserModalOpen}
        title="Benutzerverwaltung"
        maxWidth={900}
        right={<div style={{ display: 'flex', gap: 8 }}><ThemeToggleButton /></div>}
      >
        <UserManagement baseUrl={apiBase} onBack={() => setUserModalOpen(false)} />
      </Modal>

      {/* Profile Settings Modal */}
      <Modal open={profileOpen} onOpenChange={setProfileOpen} title="Profile Settings" maxWidth={600}>
        <ProfileSettings onClose={() => setProfileOpen(false)} />
      </Modal>

      {/* Billing Dashboard Modal */}
      <Modal open={billingOpen} onOpenChange={setBillingOpen} title="Billing & Subscription" maxWidth={900}>
        <BillingDashboard onClose={() => setBillingOpen(false)} />
      </Modal>

      {/* Tenant/Organization Settings Modal */}
      <Modal open={tenantSettingsOpen} onOpenChange={setTenantSettingsOpen} title="Organization Settings" maxWidth={800}>
        <TenantSettings onClose={() => setTenantSettingsOpen(false)} />
      </Modal>

      {/* Session Management Modal */}
      <Modal open={sessionsOpen} onOpenChange={setSessionsOpen} title="Active Sessions" maxWidth={700}>
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

      {/* Admin: Tenants */}
      <TenantsAdminModal open={adminOpen} onOpenChange={setAdminOpen} apiBase={apiBase} isInternalOwner={isInternalOwner} />
    </>
  );
}
