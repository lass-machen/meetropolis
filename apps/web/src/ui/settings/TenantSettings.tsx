import React from 'react';
import { useTenantSettings } from './hooks/useTenantSettings';
import { GeneralSettings } from './tenant/GeneralSettings';
import { MemberSettings } from './tenant/MemberSettings';
import { GuestSettings } from './tenant/GuestSettings';
import { Tabs, Alert } from '../system';
import type { TabItem } from '../system';

export function TenantSettings({ onClose: _onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = React.useState<'general' | 'members' | 'guests'>('general');

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
    fetchData,
    handleChangeRole,
    handleRemoveMember,
    handleInvite,
    handleCreateGuest,
    handleRevokeGuest,
  } = useTenantSettings();

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-subtle, #888)' }}>Loading organization settings...</div>;
  }

  const tabItems: TabItem[] = [
    { key: 'general', label: 'General' },
    { key: 'members', label: `Members (${members.length})` },
    ...(isEnterprise ? [{ key: 'guests', label: `Gäste (${guests.length})` }] : []),
  ];

  return (
    <>
      <Tabs items={tabItems} activeKey={activeTab} onChange={(key) => setActiveTab(key as 'general' | 'members' | 'guests')} />

      <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
        {error && <Alert intent="error" style={{ marginBottom: 16 }}>{error}</Alert>}
        {success && <Alert intent="success" style={{ marginBottom: 16 }}>{success}</Alert>}

        {activeTab === 'general' && tenant && (
          <GeneralSettings
            tenant={tenant}
            onNavigateToMembers={() => setActiveTab('members')}
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
