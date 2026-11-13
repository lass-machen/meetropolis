import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Input, Section } from '../system';
import { readAccountError, readEmailChangePending } from '../../lib/accountActionResponses';

export function ProfileEmailChangeSection({ apiBase, activeEmail, verifiedAt, onRefresh }: {
  apiBase: string; activeEmail: string; verifiedAt: string | null; onRefresh: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch(`${apiBase}/auth/verify/status`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return;
        const target = readEmailChangePending(await response.json().catch(() => null));
        if (!cancelled && target) setPending((previous) => previous ?? target);
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [apiBase, activeEmail]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setMessage(null);
    try {
      const response = await fetch(`${apiBase}/me`, { method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const body: unknown = await response.json().catch(() => null);
      const target = readEmailChangePending(body);
      if (response.ok && target) {
        setPending(target);
        setEmail('');
      }
      else
        setMessage(
          response.status === 429
            ? t('profile.emailChange.cooldown')
            : readAccountError(body).message ?? t('profile.emailChange.failed'),
        );
    } catch { setMessage(t('profile.emailChange.failed')); }
    finally { setSending(false); }
  }
  return <Section title={t('profile.emailAddress')}>
    <p>{t('profile.emailChange.active')}: <strong>{activeEmail}</strong></p>
    <Badge intent={verifiedAt ? 'success' : 'warning'}>
      {t(verifiedAt ? 'profile.emailChange.verified' : 'profile.notVerified')}
    </Badge>
    {pending && pending !== activeEmail && (
      <Alert intent="info">{t('profile.emailChange.pending', { email: pending })}</Alert>
    )}
    {pending === activeEmail && <Alert intent="success">{t('profile.emailChange.completed')}</Alert>}
    {message && <Alert intent="error">{message}</Alert>}
    <form onSubmit={(event) => { void submit(event); }} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
      <label htmlFor="profile-new-email">{t('profile.emailChange.newAddress')}</label>
      <Input
        id="profile-new-email"
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Button type="submit" variant="primary" disabled={sending || email.trim() === activeEmail}>
        {t('profile.emailChange.request')}
      </Button>
    </form>
    <Button onClick={() => { void onRefresh(); }}>{t('profile.emailChange.refresh')}</Button>
  </Section>;
}
