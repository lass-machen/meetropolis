import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { translateApiError } from '../../../lib/apiErrors';
import { Section, Button, Badge, Card, Table, THead, TBody, Tr, Th, Td, Alert, useConfirmDialog } from '../../system';

type InviteStatus = 'pending' | 'accepted' | 'expired';

type Invite = {
  id: string;
  email?: string | null;
  role?: string;
  status: InviteStatus;
  expiresAt?: string | null;
  lastSentAt?: string | null;
  lastSendError?: string | null;
  createdAt?: string;
  usedAt?: string | null;
};

interface InvitesTabProps {
  apiBase: string;
}

interface ApiErrorBody {
  error?: unknown;
}

type Notice = { text: string; intent: 'success' | 'warning' } | null;

function useInvitesTab(apiBase: string, t: TFunction) {
  const [invites, setInvites] = React.useState<Invite[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<Notice>(null);
  const [resentInvite, setResentInvite] = React.useState<{ inviteUrl: string | null } | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await fetch(`${apiBase}/invites`, { credentials: 'include' });
      if (!res.ok) {
        setLoadFailed(true);
        return;
      }
      setInvites((await res.json()) as Invite[]);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleResend = async (id: string) => {
    setError(null);
    setNotice(null);
    setResentInvite(null);
    try {
      const res = await fetch(`${apiBase}/invites/${encodeURIComponent(id)}/resend`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        const body = (await res.json()) as { emailSent?: boolean; inviteUrl?: string };
        setResentInvite({ inviteUrl: body.inviteUrl ?? null });
        setNotice({
          text: t(body.emailSent ? 'tenant.inviteResent' : 'tenant.inviteResendNotDelivered'),
          intent: body.emailSent ? 'success' : 'warning',
        });
      } else {
        const err = (await res.json().catch(() => ({}))) as ApiErrorBody;
        setError(translateApiError(err.error) || t('tenant.inviteResendFailed'));
      }
    } catch {
      setError(t('tenant.inviteResendFailed'));
    }
    await load();
  };

  const handleRevoke = async (id: string) => {
    if (!(await confirm(t('tenant.inviteDeleteConfirm')))) return;
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/invites/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      // 404 means the invite is already gone, which is what the user asked for.
      if (res.ok || res.status === 404) {
        setInvites((prev) => prev.filter((i) => i.id !== id));
      } else {
        const err = (await res.json().catch(() => ({}))) as ApiErrorBody;
        setError(translateApiError(err.error) || t('tenant.inviteRevokeFailed'));
      }
    } catch {
      setError(t('tenant.inviteRevokeFailed'));
    }
    await load();
  };

  const handleCopyResentLink = async () => {
    if (!resentInvite) return;
    if (!resentInvite.inviteUrl) {
      setError(translateApiError('public_base_url_missing'));
      return;
    }
    try {
      await navigator.clipboard.writeText(resentInvite.inviteUrl);
      setNotice({ text: t('tenant.linkCopied'), intent: 'success' });
    } catch {
      setError(t('tenant.linkCopyFailed'));
    }
  };

  return {
    invites,
    loading,
    loadFailed,
    error,
    notice,
    resentInvite,
    setError,
    load,
    handleResend,
    handleRevoke,
    handleCopyResentLink,
    confirmDialog,
  };
}

function InvitesHeader({ t }: { t: TFunction }) {
  return (
    <THead>
      <Tr>
        <Th style={{ paddingLeft: 0 }}>{t('tenant.inviteEmail')}</Th>
        <Th>{t('tenant.inviteCreatedAt')}</Th>
        <Th>{t('tenant.inviteValidUntil')}</Th>
        <Th>{t('tenant.inviteStatus')}</Th>
        <Th>{t('tenant.inviteDelivery')}</Th>
        <Th style={{ paddingRight: 0, textAlign: 'right' }}>{null}</Th>
      </Tr>
    </THead>
  );
}

function LoadingRows() {
  return (
    <TBody>
      {[1, 2, 3].map((i) => (
        <Tr key={i}>
          <Td colSpan={6} style={{ paddingLeft: 0 }}>
            <div
              style={{
                height: 16,
                borderRadius: 4,
                background: 'var(--glass-hover)',
                animation: 'pulse 1.5s ease-in-out infinite',
                width: `${60 + i * 10}%`,
              }}
            />
          </Td>
        </Tr>
      ))}
    </TBody>
  );
}

function StatusBadge({ status, t }: { status: InviteStatus; t: TFunction }) {
  if (status === 'accepted') {
    return <Badge intent="success">{t('tenant.inviteAccepted')}</Badge>;
  }
  if (status === 'expired') {
    return <Badge intent="default">{t('tenant.inviteExpired')}</Badge>;
  }
  return <Badge intent="warning">{t('tenant.invitePending')}</Badge>;
}

function DeliveryCell({ invite, t }: { invite: Invite; t: TFunction }) {
  if (invite.lastSendError === 'not_delivered') {
    return <Badge intent="danger">{t('tenant.inviteNotDelivered')}</Badge>;
  }
  if (invite.lastSentAt) {
    return <>{t('tenant.inviteSentOn', { date: new Date(invite.lastSentAt).toLocaleString() })}</>;
  }
  return <>{'\u2014'}</>;
}

function InviteRow({
  inv,
  t,
  onResend,
  onRevoke,
}: {
  inv: Invite;
  t: TFunction;
  onResend: (id: string) => void | Promise<void>;
  onRevoke: (id: string) => void | Promise<void>;
}) {
  return (
    <Tr>
      <Td style={{ paddingLeft: 0 }}>{inv.email || '\u2014'}</Td>
      <Td>{inv.createdAt ? new Date(inv.createdAt).toLocaleString() : '\u2014'}</Td>
      <Td>{inv.expiresAt ? new Date(inv.expiresAt).toLocaleString() : '\u2014'}</Td>
      <Td>
        <StatusBadge status={inv.status} t={t} />
      </Td>
      <Td>
        <DeliveryCell invite={inv} t={t} />
      </Td>
      <Td style={{ paddingRight: 0, textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {inv.status !== 'accepted' && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void onResend(inv.id);
            }}
          >
            {t('tenant.inviteResend')}
          </Button>
        )}
        {inv.status !== 'accepted' && (
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              void onRevoke(inv.id);
            }}
          >
            {t('tenant.inviteRevoke')}
          </Button>
        )}
      </Td>
    </Tr>
  );
}

export function InvitesTab({ apiBase }: InvitesTabProps) {
  const { t } = useTranslation();
  const {
    invites,
    loading,
    loadFailed,
    error,
    notice,
    resentInvite,
    setError,
    load,
    handleResend,
    handleRevoke,
    handleCopyResentLink,
    confirmDialog,
  } = useInvitesTab(apiBase, t);

  return (
    <Section title={t('tenant.tabInvites')}>
      {error && (
        <Alert intent="error" onDismiss={() => setError(null)} style={{ marginBottom: 12 }}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert intent={notice.intent} style={{ marginBottom: 12 }}>
          {notice.text}
        </Alert>
      )}
      {resentInvite && (
        <Card
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 16,
            padding: '12px 16px',
            background: 'rgba(0,0,0,0.3)',
          }}
        >
          <code
            style={{
              flex: 1,
              fontFamily: 'monospace',
              fontSize: 14,
              color: 'var(--accent, #3b82f6)',
              wordBreak: 'break-all',
            }}
          >
            {resentInvite.inviteUrl}
          </code>
          <Button
            variant="primary"
            onClick={() => {
              void handleCopyResentLink();
            }}
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            {t('tenant.copyLink')}
          </Button>
        </Card>
      )}
      {!loading && loadFailed && (
        <div>
          <Alert intent="error" style={{ marginBottom: 12 }}>
            {t('tenant.invitesLoadFailed')}
          </Alert>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void load();
            }}
          >
            {t('tenant.retry')}
          </Button>
        </div>
      )}
      {!loadFailed && (
        <Table>
          <InvitesHeader t={t} />
          {loading && <LoadingRows />}
          {!loading && invites.length === 0 && (
            <TBody>
              <Tr>
                <Td
                  colSpan={6}
                  style={{ paddingLeft: 0, textAlign: 'center', color: 'var(--fg-subtle)', padding: '32px 0' }}
                >
                  {t('tenant.noInvites')}
                </Td>
              </Tr>
            </TBody>
          )}
          {!loading && invites.length > 0 && (
            <TBody>
              {invites.map((inv) => (
                <InviteRow key={inv.id} inv={inv} t={t} onResend={handleResend} onRevoke={handleRevoke} />
              ))}
            </TBody>
          )}
        </Table>
      )}
      {confirmDialog}
    </Section>
  );
}
