import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Member } from './types';
import { InviteMember } from './InviteMember';
import { Section, Button, Select, Table, THead, TBody, Tr, Th, Td } from '../../system';

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
        <Table>
          <THead>
            <Tr>
              <Th style={{ paddingLeft: 0 }}>Name</Th>
              <Th style={{ width: 140 }}>{t('tenant.role')}</Th>
              <Th style={{ paddingRight: 0, textAlign: 'right' }}>{null}</Th>
            </Tr>
          </THead>
          <TBody>
            {members.length === 0 && (
              <Tr>
                <Td colSpan={3} style={{ paddingLeft: 0, textAlign: 'center', color: 'var(--fg-subtle)', padding: '32px 0' }}>
                  Keine Einträge vorhanden
                </Td>
              </Tr>
            )}
            {members.map((member) => (
              <Tr key={member.id}>
                <Td style={{ paddingLeft: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{member.name || member.email}</div>
                  {member.name && <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 4 }}>{member.email}</div>}
                </Td>
                <Td style={{ width: 140 }}>
                  <Select
                    value={member.role}
                    onChange={(val) => onChangeRole(member.id, val as 'admin' | 'member')}
                    disabled={member.role === 'owner' || member.role === 'guest' || saving}
                    options={[
                      { value: 'owner', label: t('tenant.roleOwner'), disabled: true },
                      { value: 'admin', label: t('tenant.roleAdmin') },
                      { value: 'member', label: t('tenant.roleMember') },
                      { value: 'guest', label: t('tenant.roleGuest'), disabled: true },
                    ]}
                  />
                </Td>
                <Td style={{ paddingRight: 0, textAlign: 'right' }}>
                  {member.role !== 'owner' && (
                    <Button
                      iconOnly
                      size="xs"
                      variant="danger"
                      onClick={() => { if (confirm(t('tenant.confirmRemoveMember'))) onRemoveMember(member.id); }}
                      disabled={saving}
                      title={t('tenant.removeMember')}
                    >
                      ×
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
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
