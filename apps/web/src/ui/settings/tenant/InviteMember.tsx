import React from 'react';
import { Button, Input, Select, Card } from '../../system';

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
    <Card style={{ marginTop: 16 }}>
      <h4 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: 'var(--fg, #fff)' }}>Invite New Member</h4>
      {inviteCode ? (
        <div style={{ textAlign: 'center' }}>
          <p>Share this invite code:</p>
          <Card style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '12px 16px', background: 'rgba(0,0,0,0.3)' }}>
            <code style={{ flex: 1, fontFamily: 'monospace', fontSize: 14, color: 'var(--accent, #3b82f6)', wordBreak: 'break-all' }}>{inviteCode}</code>
            <Button variant="primary" onClick={copyInviteLink} style={{ fontSize: 12, padding: '6px 12px' }}>Copy Link</Button>
          </Card>
          <Button variant="secondary" onClick={handleClose}>
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: 'var(--fg, #fff)' }}>Email (optional)</label>
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: 'var(--fg, #fff)' }}>Role</label>
            <Select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <Button variant="ghost" type="button" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? 'Creating...' : 'Create Invite'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
