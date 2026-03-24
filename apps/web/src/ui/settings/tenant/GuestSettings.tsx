import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Guest } from './types';
import { Section, Button, Badge, Input, Alert, Table, THead, TBody, Tr, Th, Td, NavBar, ChevronLeftIcon } from '../../system';

interface GuestSettingsProps {
  guests: Guest[];
  saving: boolean;
  onCreateGuest: (email: string, name: string, expiresAt: string) => Promise<{ magicLink: string } | null>;
  onRevokeGuest: (membershipId: string) => Promise<void>;
  onSuccess: (message: string) => void;
}

function getMinExpiry(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now();
}

type Screen = { type: 'list' } | { type: 'invite' };

export function GuestSettings({
  guests,
  saving,
  onCreateGuest,
  onRevokeGuest,
  onSuccess,
}: GuestSettingsProps) {
  const { t } = useTranslation();
  const [screen, setScreen] = React.useState<Screen>({ type: 'list' });
  const [email, setEmail] = React.useState('');
  const [name, setName] = React.useState('');
  const [expiresAt, setExpiresAt] = React.useState('');
  const [magicLink, setMagicLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !expiresAt) return;
    const result = await onCreateGuest(email, name, new Date(expiresAt).toISOString());
    if (result) {
      setMagicLink(result.magicLink);
      setEmail('');
      setName('');
      setExpiresAt('');
      onSuccess(t('guest.inviteCreated'));
    }
  };

  const handleCopy = async () => {
    if (!magicLink) return;
    try {
      await navigator.clipboard.writeText(magicLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard not available */ }
  };

  const handleRevoke = async (membershipId: string) => {
    await onRevokeGuest(membershipId);
  };

  if (screen.type === 'invite') {
    return (
      <>
        <NavBar
          left={<Button iconOnly size="sm" variant="ghost" onClick={() => { setScreen({ type: 'list' }); setMagicLink(null); }}><ChevronLeftIcon /></Button>}
          title={t('guest.inviteNew')}
        />
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Input
            type="email"
            placeholder={t('guest.emailRequired')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="text"
            placeholder={t('guest.nameOptional')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            min={getMinExpiry()}
            required
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <Button variant="primary" type="submit" disabled={saving}>
              {t('guest.sendInvite')}
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => { setScreen({ type: 'list' }); setMagicLink(null); }}
            >
              {t('guest.cancel')}
            </Button>
          </div>
        </form>

        {magicLink && (
          <Alert intent="success" style={{ marginTop: 16 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{t('guest.magicLinkLabel')}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{ flex: 1, fontSize: 12, padding: '8px 10px', background: 'rgba(0,0,0,0.3)', borderRadius: 6, color: 'var(--fg, #fff)', wordBreak: 'break-all', overflow: 'hidden' }}>{magicLink}</code>
                <Button variant="secondary" onClick={handleCopy} style={{ whiteSpace: 'nowrap' }}>
                  {copied ? t('guest.copied') : t('guest.copyLink')}
                </Button>
              </div>
            </div>
          </Alert>
        )}
      </>
    );
  }

  return (
    <Section
      title={t('guest.title')}
      actions={
        <Button
          variant="primary"
          onClick={() => { setScreen({ type: 'invite' }); setMagicLink(null); }}
        >
          {t('guest.invite')}
        </Button>
      }
    >
      {guests.length === 0 ? (
        <div style={{ color: 'var(--fg-subtle, #888)', fontSize: 14, padding: '12px 0' }}>{t('guest.noGuests')}</div>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th style={{ paddingLeft: 0 }}>Name</Th>
              <Th>{t('guest.expires')}</Th>
              <Th>Status</Th>
              <Th style={{ paddingRight: 0, textAlign: 'right' }}>{null}</Th>
            </Tr>
          </THead>
          <TBody>
            {guests.map((guest) => {
              const expired = isExpired(guest.expiresAt);
              return (
                <Tr key={guest.id}>
                  <Td style={{ paddingLeft: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{guest.name || guest.email}</div>
                    {guest.name && <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 4 }}>{guest.email}</div>}
                  </Td>
                  <Td style={{ fontSize: 13, color: 'var(--fg-subtle)' }}>
                    {new Date(guest.expiresAt).toLocaleDateString()}
                  </Td>
                  <Td>
                    <Badge intent={expired ? 'danger' : 'success'}>
                      {expired ? t('guest.expired') : t('guest.active')}
                    </Badge>
                  </Td>
                  <Td style={{ paddingRight: 0, textAlign: 'right' }}>
                    <Button
                      iconOnly
                      size="xs"
                      variant="danger"
                      onClick={() => handleRevoke(guest.id)}
                      disabled={saving}
                      title={t('guest.revoke')}
                    >
                      ×
                    </Button>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </Section>
  );
}
