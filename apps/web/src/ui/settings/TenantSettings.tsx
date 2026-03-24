import { useTranslation } from 'react-i18next';
import type { useTenantSettings } from './hooks/useTenantSettings';
import { GeneralSettings } from './tenant/GeneralSettings';
import { MemberSettings } from './tenant/MemberSettings';
import { GuestSettings } from './tenant/GuestSettings';
import { Alert } from '../system';

interface TenantSettingsProps {
  onClose: () => void;
  activeTab?: string;
  onTabChange?: (key: string) => void;
  settingsData: ReturnType<typeof useTenantSettings>;
}

export function TenantSettings({ onClose: _onClose, activeTab: activeTabProp, onTabChange, settingsData }: TenantSettingsProps) {
  const { t } = useTranslation();
  const activeTab = (activeTabProp ?? 'general') as 'general' | 'members' | 'guests';

  const {
    tenant,
    members,
    guests,
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
            onNavigateToMembers={() => onTabChange?.('members')}
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
          />
        )}

        {activeTab === 'guests' && (
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
