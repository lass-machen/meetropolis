import React from 'react';
import type { Member } from './types';
import { InviteMember } from './InviteMember';
import { Section, Button, Select } from '../../system';

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
      <Section
        title="Team Members"
        actions={
          <Button variant="primary" onClick={() => setShowInvite(true)}>
            Invite Member
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {members.map((member) => (
            <div key={member.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--fg, #fff)', fontSize: 14 }}>{member.name || member.email}</div>
                <div style={{ fontSize: 12, color: 'var(--fg-subtle, #888)' }}>{member.email}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Select
                  value={member.role}
                  onChange={(e) => onChangeRole(member.id, e.target.value as 'admin' | 'member')}
                  disabled={member.role === 'owner' || member.role === 'guest' || saving}
                  style={{ width: 'auto' }}
                >
                  <option value="owner" disabled>Owner</option>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="guest" disabled>Guest</option>
                </Select>
                {member.role !== 'owner' && (
                  <Button
                    variant="danger"
                    onClick={() => onRemoveMember(member.id)}
                    disabled={saving}
                    title="Remove member"
                    style={{ width: 28, height: 28, padding: 0 }}
                  >
                    &times;
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

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
