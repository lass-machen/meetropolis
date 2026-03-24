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

export function InvitesTab({ apiBase }: InvitesTabProps) {
  const { t } = useTranslation();
  const [invites, setInvites] = React.useState<Invite[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetchInvites();
  }, []);

  async function fetchInvites() {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/invites`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setInvites(data);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function handleDelete(code: string) {
    if (!confirm(t('tenant.inviteDeleteConfirm'))) return;
    try {
      await fetch(`${apiBase}/invites/${encodeURIComponent(code)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      setInvites(prev => prev.filter(i => i.code !== code));
    } catch { /* ignore */ }
  }

  async function handleCopy(code: string) {
    const link = `${window.location.origin}/#/?invite=${code}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch { /* clipboard not available */ }
  }

  return (
    <Section title={t('tenant.tabInvites')}>
      <Table>
        <THead>
          <Tr>
            <Th style={{ paddingLeft: 0 }}>{t('tenant.inviteCode')}</Th>
            <Th>{t('tenant.inviteEmail')}</Th>
            <Th>{t('tenant.inviteCreatedAt')}</Th>
            <Th>{t('tenant.inviteStatus')}</Th>
            <Th style={{ paddingRight: 0, textAlign: 'right' }}>{null}</Th>
          </Tr>
        </THead>

        {loading && (
          <TBody>
            {[1, 2, 3].map(i => (
              <Tr key={i}>
                <Td colSpan={5} style={{ paddingLeft: 0 }}>
                  <div style={{
                    height: 16,
                    borderRadius: 4,
                    background: 'var(--glass-hover)',
                    animation: 'pulse 1.5s ease-in-out infinite',
                    width: `${60 + i * 10}%`,
                  }} />
                </Td>
              </Tr>
            ))}
          </TBody>
        )}

        {!loading && invites.length === 0 && (
          <TBody>
            <Tr>
              <Td
                colSpan={5}
                style={{
                  paddingLeft: 0,
                  textAlign: 'center',
                  color: 'var(--fg-subtle)',
                  padding: '32px 0',
                }}
              >
                {t('tenant.noInvites')}
              </Td>
            </Tr>
          </TBody>
        )}

        {!loading && invites.length > 0 && (
          <TBody>
            {invites.map(inv => (
              <Tr key={inv.code}>
                <Td style={{ paddingLeft: 0 }}>
                  <code style={{
                    display: 'inline-block',
                    padding: '4px 6px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'rgba(255,255,255,0.06)',
                  }}>
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
                  <Button size="sm" variant="secondary" onClick={() => handleCopy(inv.code)}>
                    {t('tenant.inviteCopy')}
                  </Button>
                  {!inv.usedAt && (
                    <Button size="sm" variant="danger" onClick={() => handleDelete(inv.code)}>
                      {t('tenant.inviteDelete')}
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        )}
      </Table>
    </Section>
  );
}
