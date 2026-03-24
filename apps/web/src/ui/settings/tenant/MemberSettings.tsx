import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Member } from './types';
import { InviteMember } from './InviteMember';
import { Section, Button, Select, Table, THead, TBody, Tr, Th, Td, Input, Alert } from '../../system';

interface MemberSettingsProps {
  members: Member[];
  saving: boolean;
  onChangeRole: (userId: string, newRole: 'admin' | 'member') => void;
  onRemoveMember: (userId: string) => void;
  onInvite: (email: string, role: 'admin' | 'member') => Promise<string | null>;
  onSuccess: (message: string) => void;
  onResetPassword: (email: string) => Promise<string | null>;
  onEditMember: (userId: string, data: { email?: string; name?: string }) => Promise<boolean>;
}

export function MemberSettings({
  members,
  saving,
  onChangeRole,
  onRemoveMember,
  onInvite,
  onSuccess,
  onResetPassword,
  onEditMember,
}: MemberSettingsProps) {
  const { t } = useTranslation();
  const [showInvite, setShowInvite] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState('');
  const [editEmail, setEditEmail] = React.useState('');
  const [resetToken, setResetToken] = React.useState<{ userId: string; token: string } | null>(null);

  function startEdit(member: Member) {
    setEditingId(member.id);
    setEditName(member.name || '');
    setEditEmail(member.email);
    setResetToken(null);
  }

  async function saveEdit(userId: string) {
    const payload: { email?: string; name?: string } = { email: editEmail };
    if (editName) payload.name = editName;
    const success = await onEditMember(userId, payload);
    if (success) {
      setEditingId(null);
      onSuccess(t('tenant.editSuccess'));
    }
  }

  async function handleReset(member: Member) {
    setResetToken(null);
    const token = await onResetPassword(member.email);
    if (token) {
      setResetToken({ userId: member.id, token });
    }
  }

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
            {members.map((member) =>
              editingId === member.id ? (
                <Tr key={member.id}>
                  <Td style={{ paddingLeft: 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" style={{ fontSize: 14 }} />
                      <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email" style={{ fontSize: 13 }} />
                    </div>
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
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button size="sm" variant="primary" onClick={() => saveEdit(member.id)} disabled={saving}>
                        {t('tenant.saveMember')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        {t('tenant.cancelEdit')}
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ) : (
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
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button size="sm" variant="secondary" onClick={() => startEdit(member)}>
                        {t('tenant.editMember')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => handleReset(member)}>
                        {t('tenant.resetPassword')}
                      </Button>
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
                    </div>
                  </Td>
                </Tr>
              )
            )}
          </TBody>
        </Table>

        {resetToken && (
          <Alert intent="success" onDismiss={() => setResetToken(null)} style={{ marginTop: 12 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{t('tenant.resetSuccess')}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{ flex: 1, fontSize: 12, padding: '6px 8px', background: 'rgba(0,0,0,0.3)', borderRadius: 4, wordBreak: 'break-all' }}>{resetToken.token}</code>
                <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard.writeText(resetToken.token); }}>
                  {t('tenant.copyToken')}
                </Button>
              </div>
            </div>
          </Alert>
        )}
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
