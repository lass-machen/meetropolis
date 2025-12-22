import React from 'react';

interface InviteMemberProps {
  saving: boolean;
  onInvite: (email: string, role: 'admin' | 'member') => Promise<string | null>;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function InviteMember({ saving, onInvite, onClose, onSuccess }: InviteMemberProps) {
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteRole, setInviteRole] = React.useState<'admin' | 'member'>('member');
  const [inviteCode, setInviteCode] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = await onInvite(inviteEmail, inviteRole);
    if (code) {
      setInviteCode(code);
    }
  };

  const copyInviteLink = () => {
    if (!inviteCode) return;
    const link = `${window.location.origin}/#/?invite=${inviteCode}`;
    navigator.clipboard.writeText(link);
    onSuccess('Invite link copied to clipboard');
  };

  const handleClose = () => {
    setInviteCode(null);
    setInviteEmail('');
    setInviteRole('member');
    onClose();
  };

  return (
    <div style={styles.inviteSection}>
      <h4 style={styles.inviteTitle}>Invite New Member</h4>
      {inviteCode ? (
        <div style={styles.inviteSuccess}>
          <p>Share this invite code:</p>
          <div style={styles.inviteCodeBox}>
            <code style={styles.inviteCode}>{inviteCode}</code>
            <button onClick={copyInviteLink} style={styles.copyBtn}>Copy Link</button>
          </div>
          <button onClick={handleClose} style={styles.secondaryBtn}>
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div style={styles.field}>
            <label style={styles.label}>Email (optional)</label>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              style={styles.input}
              placeholder="user@example.com"
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
              style={styles.input}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div style={styles.buttonRow}>
            <button type="button" onClick={handleClose} style={styles.cancelBtn}>
              Cancel
            </button>
            <button type="submit" disabled={saving} style={styles.primaryBtn}>
              {saving ? 'Creating...' : 'Create Invite'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  inviteSection: {
    marginTop: 16,
    padding: 16,
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
  },
  inviteTitle: {
    margin: '0 0 16px',
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--fg, #fff)',
  },
  inviteSuccess: {
    textAlign: 'center',
  },
  inviteCodeBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    padding: '12px 16px',
    background: 'rgba(0,0,0,0.3)',
    borderRadius: 8,
  },
  inviteCode: {
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 14,
    color: 'var(--accent, #3b82f6)',
    wordBreak: 'break-all',
  },
  copyBtn: {
    padding: '6px 12px',
    background: 'var(--accent, #3b82f6)',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: 12,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  field: {
    marginBottom: 16,
  },
  label: {
    display: 'block',
    marginBottom: 6,
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--fg, #fff)',
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--border, rgba(255,255,255,0.1))',
    borderRadius: 8,
    color: 'var(--fg, #fff)',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  },
  buttonRow: {
    display: 'flex',
    gap: 12,
    marginTop: 12,
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
  secondaryBtn: {
    padding: '10px 20px',
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid var(--border, rgba(255,255,255,0.2))',
    borderRadius: 8,
    color: 'var(--fg, #fff)',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  cancelBtn: {
    padding: '10px 20px',
    background: 'transparent',
    border: '1px solid var(--border, rgba(255,255,255,0.2))',
    borderRadius: 8,
    color: 'var(--fg-subtle, #888)',
    fontSize: 14,
    cursor: 'pointer',
  },
};
