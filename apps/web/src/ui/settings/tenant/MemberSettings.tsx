import React from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const [showInvite, setShowInvite] = React.useState(false);

  return (
    <>
      <Section
        title={t('tenant.teamMembers')}
        actions={
          <Button variant="primary" onClick={() => setShowInvite(true)}>
            {t('tenant.inviteMember')}
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
                  onChange={(val) => onChangeRole(member.id, val as 'admin' | 'member')}
                  disabled={member.role === 'owner' || member.role === 'guest' || saving}
                  style={{ width: 'auto' }}
                  options={[
                    { value: 'owner', label: t('tenant.roleOwner'), disabled: true },
                    { value: 'admin', label: t('tenant.roleAdmin') },
                    { value: 'member', label: t('tenant.roleMember') },
                    { value: 'guest', label: t('tenant.roleGuest'), disabled: true },
                  ]}
                />
                {member.role !== 'owner' && (
                  <Button
                    iconOnly
                    size="xs"
                    variant="danger"
                    onClick={() => onRemoveMember(member.id)}
                    disabled={saving}
                    title={t('tenant.removeMember')}
                  >
                    ×
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
