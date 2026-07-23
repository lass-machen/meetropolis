import React from 'react';
import { Toolbar, Button, Card, Table, THead, Tr, Th, TableContainer } from '../../ui/system';
import { useTranslation } from 'react-i18next';
import { useUserManagement } from './useUserManagement';
import { UsersTableBody } from './UserManagementTable';
import { CreateUserModal, ResetModal } from './UserModals';
import type { EditUser } from './userManagementTypes';

export function UserManagement(props: { baseUrl: string; onBack: () => void }) {
  const { baseUrl, onBack } = props;
  const { t } = useTranslation();
  const { loading, users, error, setError, currentUserId, canChangeRoles, isOwner, changeRole, save, remove } =
    useUserManagement(baseUrl, t);
  const [edit, setEdit] = React.useState<EditUser | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [resetFor, setResetFor] = React.useState<{ id: string; email: string } | null>(null);
  const [resetToken, setResetToken] = React.useState<string | null>(null);
  const [resetUrl, setResetUrl] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

  const openReset = (data: { for: { id: string; email: string }; token: string | null; resetUrl?: string | null }) => {
    setResetFor(data.for);
    setResetToken(data.token);
    setResetUrl(data.resetUrl || null);
    setResetOpen(true);
  };
  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    await remove(id);
  };

  return (
    <div style={{ width: '100%', display: 'grid', gap: 10 }}>
      <Toolbar
        left={
          <>
            <Button onClick={onBack}>← {t('admin.users.back')}</Button>
            <div
              style={{
                padding: '6px 12px',
                borderRadius: 20,
                background: 'var(--glass)',
                border: '1px solid var(--border)',
                fontSize: 12,
                color: 'var(--fg)',
                fontWeight: 600,
              }}
            >
              {t('admin.users.adminBadge')}
            </div>
          </>
        }
        right={
          <>
            <Button variant="brand" onClick={() => setCreateOpen(true)}>
              + {t('admin.users.newUser')}
            </Button>
          </>
        }
        style={{ background: 'transparent', border: 'none', padding: 0 }}
      />

      {error && (
        <Card style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <div style={{ color: '#fca5a5' }}>{error}</div>
        </Card>
      )}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <TableContainer maxHeight="60vh">
          <Table>
            <THead sticky>
              <Tr>
                <Th style={{ paddingLeft: 0 }}>{t('admin.users.email')}</Th>
                <Th>{t('admin.users.name')}</Th>
                <Th>{t('admin.users.role')}</Th>
                <Th style={{ paddingRight: 0 }}>{null}</Th>
              </Tr>
            </THead>
            <UsersTableBody
              loading={loading}
              users={users}
              edit={edit}
              setEdit={setEdit}
              canChangeRoles={canChangeRoles}
              currentUserId={currentUserId}
              changeRole={(id, r) => {
                void changeRole(id, r);
              }}
              save={save}
              baseUrl={baseUrl}
              setError={setError}
              openReset={openReset}
              confirmDeleteId={confirmDeleteId}
              setConfirmDeleteId={setConfirmDeleteId}
              onDelete={(id) => {
                void handleDelete(id);
              }}
            />
          </Table>
        </TableContainer>
      </Card>

      <CreateUserModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        baseUrl={baseUrl}
        isOwner={isOwner}
        setError={setError}
      />
      <ResetModal
        open={resetOpen}
        onOpenChange={setResetOpen}
        resetFor={resetFor}
        resetToken={resetToken}
        resetUrl={resetUrl}
      />
    </div>
  );
}
