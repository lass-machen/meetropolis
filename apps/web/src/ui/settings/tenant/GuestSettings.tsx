import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Guest } from './types';

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

export function GuestSettings({
  guests,
  saving,
  onCreateGuest,
  onRevokeGuest,
  onSuccess,
}: GuestSettingsProps) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = React.useState(false);
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

  return (
    <>
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionTitle}>{t('guest.title')}</h3>
          <button
            onClick={() => { setShowForm(true); setMagicLink(null); }}
            style={styles.primaryBtn}
          >
            {t('guest.invite')}
          </button>
        </div>

        <div style={styles.memberList}>
          {guests.length === 0 && (
            <div style={styles.emptyText}>{t('guest.noGuests')}</div>
          )}
          {guests.map((guest) => {
            const expired = isExpired(guest.expiresAt);
            return (
              <div key={guest.id} style={styles.memberItem}>
                <div style={styles.memberInfo}>
                  <div style={styles.memberName}>{guest.name || guest.email}</div>
                  <div style={styles.memberEmail}>
                    {guest.email} &middot; {t('guest.expires')}: {new Date(guest.expiresAt).toLocaleString()}
                  </div>
                </div>
                <div style={styles.memberActions}>
                  <span style={{
                    ...styles.badge,
                    background: expired ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)',
                    color: expired ? '#ef4444' : '#22c55e',
                  }}>
                    {expired ? t('guest.expired') : t('guest.active')}
                  </span>
                  <button
                    onClick={() => handleRevoke(guest.id)}
                    disabled={saving}
                    style={styles.removeBtn}
                    title={t('guest.revoke')}
                  >
                    &times;
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showForm && (
        <div style={styles.formSection}>
          <h4 style={styles.formTitle}>{t('guest.inviteNew')}</h4>
          <form onSubmit={handleCreate} style={styles.form}>
            <input
              type="email"
              placeholder={t('guest.emailRequired')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={styles.input}
            />
            <input
              type="text"
              placeholder={t('guest.nameOptional')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={styles.input}
            />
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={getMinExpiry()}
              required
              style={styles.input}
            />
            <div style={styles.formActions}>
              <button type="submit" disabled={saving} style={styles.primaryBtn}>
                {t('guest.sendInvite')}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setMagicLink(null); }}
                style={styles.cancelBtn}
              >
                {t('guest.cancel')}
              </button>
            </div>
          </form>

          {magicLink && (
            <div style={styles.magicLinkBox}>
              <div style={styles.magicLinkLabel}>{t('guest.magicLinkLabel')}</div>
              <div style={styles.magicLinkRow}>
                <code style={styles.magicLinkCode}>{magicLink}</code>
                <button onClick={handleCopy} style={styles.copyBtn}>
                  {copied ? t('guest.copied') : t('guest.copyLink')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--fg-subtle, #888)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  primaryBtn: {
    padding: '10px 20px',
    background: 'var(--accent, #3b82f6)',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  memberList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  memberItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontWeight: 600,
    color: 'var(--fg, #fff)',
    fontSize: 14,
  },
  memberEmail: {
    fontSize: 12,
    color: 'var(--fg-subtle, #888)',
  },
  memberActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    padding: '4px 10px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
  },
  removeBtn: {
    width: 28,
    height: 28,
    background: 'rgba(239,68,68,0.2)',
    border: 'none',
    borderRadius: 6,
    color: '#ef4444',
    fontSize: 18,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: 'var(--fg-subtle, #888)',
    fontSize: 14,
    padding: '12px 0',
  },
  formSection: {
    padding: '16px',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 8,
    border: '1px solid var(--border, rgba(255,255,255,0.1))',
  },
  formTitle: {
    margin: '0 0 12px',
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--fg, #fff)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  input: {
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid var(--border, rgba(255,255,255,0.2))',
    borderRadius: 8,
    color: 'var(--fg, #fff)',
    fontSize: 14,
    outline: 'none',
  },
  formActions: {
    display: 'flex',
    gap: 8,
    marginTop: 4,
  },
  cancelBtn: {
    padding: '10px 20px',
    background: 'rgba(255,255,255,0.1)',
    border: 'none',
    borderRadius: 8,
    color: 'var(--fg, #fff)',
    fontSize: 14,
    cursor: 'pointer',
  },
  magicLinkBox: {
    marginTop: 16,
    padding: 12,
    background: 'rgba(34,197,94,0.1)',
    border: '1px solid rgba(34,197,94,0.3)',
    borderRadius: 8,
  },
  magicLinkLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: '#22c55e',
    marginBottom: 8,
  },
  magicLinkRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  magicLinkCode: {
    flex: 1,
    fontSize: 12,
    padding: '8px 10px',
    background: 'rgba(0,0,0,0.3)',
    borderRadius: 6,
    color: 'var(--fg, #fff)',
    wordBreak: 'break-all',
    overflow: 'hidden',
  },
  copyBtn: {
    padding: '8px 14px',
    background: 'rgba(34,197,94,0.2)',
    border: 'none',
    borderRadius: 6,
    color: '#22c55e',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
};
