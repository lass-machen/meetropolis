import { useTranslation } from 'react-i18next';
import type { useTenantSettings } from './hooks/useTenantSettings';
import { GeneralSettings } from './tenant/GeneralSettings';
import { MemberSettings } from './tenant/MemberSettings';
import { GuestSettings } from './tenant/GuestSettings';
import { InvitesTab } from './tenant/InvitesTab';
import { Alert } from '../system';

interface TenantSettingsProps {
  onClose: () => void;
  activeTab?: string;
  onTabChange?: (key: string) => void;
  apiBase: string;
  settingsData: ReturnType<typeof useTenantSettings>;
}

export function TenantSettings({ onClose: _onClose, activeTab: activeTabProp, onTabChange: _onTabChange, apiBase, settingsData }: TenantSettingsProps) {
  const { t } = useTranslation();
  const activeTab = (activeTabProp ?? 'general') as 'general' | 'members' | 'guests' | 'invites';

  const {
    tenant,
    members,
    guests,
    isEnterprise,
    loading,
    saving,
    error,
    success,
    setSuccess,
    handleChangeRole,
    handleRemoveMember,
    handleInvite,
    handleCreateGuest,
    handleRevokeGuest,
    handleResetPassword,
    handleEditMember,
    handleUpdateTenant,
  } = settingsData;

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-subtle, #888)' }}>{t('tenant.loading')}</div>;
  }

  return (
    <>
      <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
        {error && <Alert intent="error" style={{ marginBottom: 16 }}>{error}</Alert>}
        {success && <Alert intent="success" style={{ marginBottom: 16 }}>{success}</Alert>}

        {activeTab === 'general' && tenant && (
          <GeneralSettings
            tenant={tenant}
            saving={saving}
            apiBase={apiBase}
            onUpdateTenant={handleUpdateTenant}
            onSuccess={setSuccess}
            memberCount={members.length}
            guestCount={isEnterprise ? guests.length : undefined}
          />
        )}

        {activeTab === 'members' && (
          <MemberSettings
            members={members}
            saving={saving}
            onChangeRole={handleChangeRole}
            onRemoveMember={handleRemoveMember}
            onInvite={handleInvite}
            onSuccess={setSuccess}
            onResetPassword={handleResetPassword}
            onEditMember={handleEditMember}
          />
        )}

        {activeTab === 'invites' && (
          <InvitesTab apiBase={apiBase} />
        )}

        {activeTab === 'guests' && isEnterprise && (
          <GuestSettings
            guests={guests}
            saving={saving}
            onCreateGuest={handleCreateGuest}
            onRevokeGuest={handleRevokeGuest}
            onSuccess={setSuccess}
          />
        )}
      </div>
    </>
  );
}

export default TenantSettings;
