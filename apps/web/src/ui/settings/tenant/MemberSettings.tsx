import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Member } from './types';
import { InviteMember } from './InviteMember';
import {
  Section,
  Button,
  Select,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
  Input,
  Alert,
  NavBar,
  ChevronLeftIcon,
} from '../../system';

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

type Screen = { type: 'list' } | { type: 'invite' } | { type: 'edit'; member: Member };

function EditMemberScreen({
  member,
  editName,
  setEditName,
  editEmail,
  setEditEmail,
  saving,
  onSave,
  onCancel,
}: {
  member: Member;
  editName: string;
  setEditName: (v: string) => void;
  editEmail: string;
  setEditEmail: (v: string) => void;
  saving: boolean;
  onSave: (id: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <NavBar
        left={
          <Button iconOnly size="sm" variant="ghost" onClick={onCancel}>
            <ChevronLeftIcon />
          </Button>
        }
        title={t('tenant.editMember')}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label
            htmlFor="edit-member-name"
            style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--fg)' }}
          >
            Name
          </label>
          <Input
            id="edit-member-name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Name"
          />
        </div>
        <div>
          <label
            htmlFor="edit-member-email"
            style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--fg)' }}
          >
            {t('profile.emailAddress')}
          </label>
          <Input
            id="edit-member-email"
            value={editEmail}
            onChange={(e) => setEditEmail(e.target.value)}
            placeholder="Email"
          />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <Button
            variant="primary"
            onClick={() => {
              void onSave(member.id);
            }}
            disabled={saving}
          >
            {t('tenant.saveMember')}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t('tenant.cancelEdit')}
          </Button>
        </div>
      </div>
    </>
  );
}

function MemberRow({
  member,
  saving,
  onChangeRole,
  onRemoveMember,
  onEdit,
  onReset,
}: {
  member: Member;
  saving: boolean;
  onChangeRole: (uid: string, r: 'admin' | 'member') => void;
  onRemoveMember: (uid: string) => void;
  onEdit: (m: Member) => void;
  onReset: (m: Member) => void;
}) {
  const { t } = useTranslation();
  return (
    <Tr>
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
          <Button size="sm" variant="secondary" onClick={() => onEdit(member)}>
            {t('tenant.editMember')}
          </Button>
          <Button size="sm" variant="danger" onClick={() => onReset(member)}>
            {t('tenant.resetPassword')}
          </Button>
          {member.role !== 'owner' && (
            <Button
              iconOnly
              size="xs"
              variant="danger"
              onClick={() => {
                if (confirm(t('tenant.confirmRemoveMember'))) onRemoveMember(member.id);
              }}
              disabled={saving}
              title={t('tenant.removeMember')}
            >
              ×
            </Button>
          )}
        </div>
      </Td>
    </Tr>
  );
}

function ResetTokenAlert({ token, onDismiss }: { token: string; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert intent="success" onDismiss={onDismiss} style={{ marginTop: 12 }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{t('tenant.resetSuccess')}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <code
            style={{
              flex: 1,
              fontSize: 12,
              padding: '6px 8px',
              background: 'rgba(0,0,0,0.3)',
              borderRadius: 4,
              wordBreak: 'break-all',
            }}
          >
            {token}
          </code>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(token);
            }}
          >
            {t('tenant.copyToken')}
          </Button>
        </div>
      </div>
    </Alert>
  );
}

function MemberListView({
  members,
  saving,
  onChangeRole,
  onRemoveMember,
  onEdit,
  onReset,
  onInvite,
  resetToken,
  onDismissReset,
}: {
  members: Member[];
  saving: boolean;
  onChangeRole: MemberSettingsProps['onChangeRole'];
  onRemoveMember: MemberSettingsProps['onRemoveMember'];
  onEdit: (m: Member) => void;
  onReset: (m: Member) => void;
  onInvite: () => void;
  resetToken: { userId: string; token: string } | null;
  onDismissReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Section
      title={t('tenant.teamMembers')}
      actions={
        <Button variant="primary" onClick={onInvite}>
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
              <Td
                colSpan={3}
                style={{ paddingLeft: 0, textAlign: 'center', color: 'var(--fg-subtle)', padding: '32px 0' }}
              >
                Keine Einträge vorhanden
              </Td>
            </Tr>
          )}
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              saving={saving}
              onChangeRole={onChangeRole}
              onRemoveMember={onRemoveMember}
              onEdit={onEdit}
              onReset={onReset}
            />
          ))}
        </TBody>
      </Table>
      {resetToken && <ResetTokenAlert token={resetToken.token} onDismiss={onDismissReset} />}
    </Section>
  );
}

function useMemberSettingsState(props: MemberSettingsProps) {
  const { t } = useTranslation();
  const { onEditMember, onSuccess, onResetPassword } = props;
  const [screen, setScreen] = React.useState<Screen>({ type: 'list' });
  const [editName, setEditName] = React.useState('');
  const [editEmail, setEditEmail] = React.useState('');
  const [resetToken, setResetToken] = React.useState<{ userId: string; token: string } | null>(null);

  const startEdit = (member: Member) => {
    setEditName(member.name || '');
    setEditEmail(member.email);
    setScreen({ type: 'edit', member });
    setResetToken(null);
  };

  const saveEdit = async (userId: string) => {
    const payload: { email?: string; name?: string } = { email: editEmail };
    if (editName) payload.name = editName;
    const success = await onEditMember(userId, payload);
    if (success) {
      setScreen({ type: 'list' });
      onSuccess(t('tenant.editSuccess'));
    }
  };

  const handleReset = async (member: Member) => {
    setResetToken(null);
    const token = await onResetPassword(member.email);
    if (token) setResetToken({ userId: member.id, token });
  };

  return {
    screen,
    setScreen,
    editName,
    setEditName,
    editEmail,
    setEditEmail,
    resetToken,
    setResetToken,
    startEdit,
    saveEdit,
    handleReset,
  };
}

export function MemberSettings(props: MemberSettingsProps) {
  const { t } = useTranslation();
  const { members, saving, onChangeRole, onRemoveMember, onInvite, onSuccess } = props;
  const state = useMemberSettingsState(props);
  const {
    screen,
    setScreen,
    editName,
    setEditName,
    editEmail,
    setEditEmail,
    resetToken,
    setResetToken,
    startEdit,
    saveEdit,
    handleReset,
  } = state;

  if (screen.type === 'invite') {
    return (
      <>
        <NavBar
          left={
            <Button iconOnly size="sm" variant="ghost" onClick={() => setScreen({ type: 'list' })}>
              <ChevronLeftIcon />
            </Button>
          }
          title={t('tenant.inviteMember')}
        />
        <InviteMember
          saving={saving}
          onInvite={onInvite}
          onClose={() => setScreen({ type: 'list' })}
          onSuccess={onSuccess}
        />
      </>
    );
  }

  if (screen.type === 'edit') {
    return (
      <EditMemberScreen
        member={screen.member}
        editName={editName}
        setEditName={setEditName}
        editEmail={editEmail}
        setEditEmail={setEditEmail}
        saving={saving}
        onSave={saveEdit}
        onCancel={() => setScreen({ type: 'list' })}
      />
    );
  }

  return (
    <MemberListView
      members={members}
      saving={saving}
      onChangeRole={onChangeRole}
      onRemoveMember={onRemoveMember}
      onEdit={startEdit}
      onReset={(m) => {
        void handleReset(m);
      }}
      onInvite={() => setScreen({ type: 'invite' })}
      resetToken={resetToken}
      onDismissReset={() => setResetToken(null)}
    />
  );
}
