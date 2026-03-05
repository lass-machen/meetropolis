import React from 'react';
import type { Member } from './types';
import { InviteMember } from './InviteMember';

interface MemberSettingsProps {
  members: Member[];
  saving: boolean;
  onChangeRole: (userId: string, newRole: 'admin' | 'member') => void;
  onRemoveMember: (userId: string) => void;
  onInvite: (email: string, role: 'admin' | 'member') => Promise<string | null>;
  onSuccess: (message: string) => void;
}

export function MemberSettings({
  members,
  saving,
  onChangeRole,
  onRemoveMember,
  onInvite,
  onSuccess,
}: MemberSettingsProps) {
  const [showInvite, setShowInvite] = React.useState(false);

  return (
    <>
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionTitle}>Team Members</h3>
          <button onClick={() => setShowInvite(true)} style={styles.primaryBtn}>
            Invite Member
          </button>
        </div>

        <div style={styles.memberList}>
          {members.map((member) => (
            <div key={member.id} style={styles.memberItem}>
              <div style={styles.memberInfo}>
                <div style={styles.memberName}>{member.name || member.email}</div>
                <div style={styles.memberEmail}>{member.email}</div>
              </div>
              <div style={styles.memberActions}>
                <select
                  value={member.role}
                  onChange={(e) => onChangeRole(member.id, e.target.value as 'admin' | 'member')}
                  disabled={member.role === 'owner' || member.role === 'guest' || saving}
                  style={styles.roleSelect}
                >
                  <option value="owner" disabled>Owner</option>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="guest" disabled>Guest</option>
                </select>
                {member.role !== 'owner' && (
                  <button
                    onClick={() => onRemoveMember(member.id)}
                    disabled={saving}
                    style={styles.removeBtn}
                    title="Remove member"
                  >
                    &times;
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {showInvite && (
        <InviteMember
          saving={saving}
          onInvite={onInvite}
          onClose={() => setShowInvite(false)}
          onSuccess={onSuccess}
        />
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--fg-subtle, #888)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  primaryBtn: {
    padding: '10px 20px',
    background: 'var(--accent, #3b82f6)',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  memberList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  memberItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontWeight: 600,
    color: 'var(--fg, #fff)',
    fontSize: 14,
  },
  memberEmail: {
    fontSize: 12,
    color: 'var(--fg-subtle, #888)',
  },
  memberActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  roleSelect: {
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid var(--border, rgba(255,255,255,0.2))',
    borderRadius: 6,
    color: 'var(--fg, #fff)',
    fontSize: 13,
    cursor: 'pointer',
  },
  removeBtn: {
    width: 28,
    height: 28,
    background: 'rgba(239,68,68,0.2)',
    border: 'none',
    borderRadius: 6,
    color: '#ef4444',
    fontSize: 18,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
