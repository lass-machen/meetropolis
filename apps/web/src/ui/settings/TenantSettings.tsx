import React from 'react';
import { useTenantSettings } from './hooks/useTenantSettings';
import { GeneralSettings } from './tenant/GeneralSettings';
import { MemberSettings } from './tenant/MemberSettings';

export function TenantSettings({ onClose: _onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = React.useState<'general' | 'members'>('general');

  const {
    tenant,
    members,
    loading,
    saving,
    error,
    success,
    setSuccess,
    fetchData,
    handleChangeRole,
    handleRemoveMember,
    handleInvite,
  } = useTenantSettings();

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <div style={styles.loading}>Loading organization settings...</div>;
  }

  return (
    <>
      <div style={styles.tabs}>
        <button
          onClick={() => setActiveTab('general')}
          style={{ ...styles.tab, ...(activeTab === 'general' ? styles.tabActive : {}) }}
        >
          General
        </button>
        <button
          onClick={() => setActiveTab('members')}
          style={{ ...styles.tab, ...(activeTab === 'members' ? styles.tabActive : {}) }}
        >
          Members ({members.length})
        </button>
      </div>

      <div style={styles.content}>
        {error && <div style={styles.error}>{error}</div>}
        {success && <div style={styles.success}>{success}</div>}

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
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  tabs: {
    display: 'flex',
    gap: 4,
    padding: '8px 16px',
    borderBottom: '1px solid var(--border, rgba(255,255,255,0.1))',
  },
  tab: {
    padding: '8px 16px',
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    color: 'var(--fg-subtle, #888)',
    fontSize: 14,
    fontWeight: 500,
  },
  tabActive: {
    background: 'var(--accent, #3b82f6)',
    color: '#fff',
  },
  content: {
    padding: 20,
    overflowY: 'auto',
    flex: 1,
  },
  loading: {
    padding: 40,
    textAlign: 'center',
    color: 'var(--fg-subtle, #888)',
  },
  error: {
    padding: '10px 14px',
    background: 'rgba(239,68,68,0.15)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 8,
    color: '#ef4444',
    fontSize: 14,
    marginBottom: 16,
  },
  success: {
    padding: '10px 14px',
    background: 'rgba(34,197,94,0.15)',
    border: '1px solid rgba(34,197,94,0.3)',
    borderRadius: 8,
    color: '#22c55e',
    fontSize: 14,
    marginBottom: 16,
  },
};

export default TenantSettings;
