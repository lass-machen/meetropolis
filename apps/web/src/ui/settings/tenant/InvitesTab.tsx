import React from 'react';
import { useTranslation } from 'react-i18next';
import { Section, Button, Badge, Table, THead, TBody, Tr, Th, Td } from '../../system';

type Invite = {
  code: string;
  email?: string | null;
  usedAt?: string | null;
  createdAt?: string;
};

interface InvitesTabProps {
  apiBase: string;
}

function useInvitesTab(apiBase: string, t: (k: string) => string) {
  const [invites, setInvites] = React.useState<Invite[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${apiBase}/invites`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setInvites(data);
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const handleDelete = async (code: string) => {
    if (!confirm(t('tenant.inviteDeleteConfirm'))) return;
    try {
      await fetch(`${apiBase}/invites/${encodeURIComponent(code)}`, { method: 'DELETE', credentials: 'include' });
      setInvites((prev) => prev.filter((i) => i.code !== code));
    } catch {
      /* ignore */
    }
  };

  const handleCopy = async (code: string) => {
    const link = `${window.location.origin}/#/?invite=${code}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      /* clipboard not available */
    }
  };

  return { invites, loading, handleDelete, handleCopy };
}

function InvitesHeader({ t }: { t: (k: string) => string }) {
  return (
    <THead>
      <Tr>
        <Th style={{ paddingLeft: 0 }}>{t('tenant.inviteCode')}</Th>
        <Th>{t('tenant.inviteEmail')}</Th>
        <Th>{t('tenant.inviteCreatedAt')}</Th>
        <Th>{t('tenant.inviteStatus')}</Th>
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
          <Td colSpan={5} style={{ paddingLeft: 0 }}>
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

function InviteRow({
  inv,
  t,
  onCopy,
  onDelete,
}: {
  inv: Invite;
  t: (k: string) => string;
  onCopy: (code: string) => void | Promise<void>;
  onDelete: (code: string) => void | Promise<void>;
}) {
  return (
    <Tr>
      <Td style={{ paddingLeft: 0 }}>
        <code
          style={{
            display: 'inline-block',
            padding: '4px 6px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'rgba(255,255,255,0.06)',
          }}
        >
          {inv.code}
        </code>
      </Td>
      <Td>{inv.email || '\u2014'}</Td>
      <Td>{inv.createdAt ? new Date(inv.createdAt).toLocaleString() : '\u2014'}</Td>
      <Td>
        <Badge intent={inv.usedAt ? 'danger' : 'success'}>
          {inv.usedAt ? t('tenant.inviteUsed') : t('tenant.invitePending')}
        </Badge>
      </Td>
      <Td style={{ paddingRight: 0, textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void onCopy(inv.code);
          }}
        >
          {t('tenant.inviteCopy')}
        </Button>
        {!inv.usedAt && (
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              void onDelete(inv.code);
            }}
          >
            {t('tenant.inviteDelete')}
          </Button>
        )}
      </Td>
    </Tr>
  );
}

export function InvitesTab({ apiBase }: InvitesTabProps) {
  const { t } = useTranslation();
  const { invites, loading, handleDelete, handleCopy } = useInvitesTab(apiBase, t);

  return (
    <Section title={t('tenant.tabInvites')}>
      <Table>
        <InvitesHeader t={t} />
        {loading && <LoadingRows />}
        {!loading && invites.length === 0 && (
          <TBody>
            <Tr>
              <Td
                colSpan={5}
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
              <InviteRow key={inv.code} inv={inv} t={t} onCopy={handleCopy} onDelete={handleDelete} />
            ))}
          </TBody>
        )}
      </Table>
    </Section>
  );
}
