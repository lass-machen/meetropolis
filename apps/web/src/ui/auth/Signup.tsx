import React from 'react';
import { Button, Input, Card } from '../system';

export function Signup(props: { apiBase: string; onSuccess: (tenantSlug: string) => void }) {
  const { apiBase, onSuccess } = props;
  const [slug, setSlug] = React.useState('');
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (!slug || !name || !email || !password) { setError('Bitte alle Felder ausfüllen.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/public/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ slug, name, email, password })
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      onSuccess(slug);
    } catch (e: unknown) {
      setError(e?.message || 'Registrierung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ maxWidth: 520, margin: '0 auto', padding: 16 }}>
      <form onSubmit={submit}>
        <div style={{ display:'grid', gap: 10 }}>
          <div>
            <div style={{ fontSize: 14, marginBottom: 4 }}>Subdomain</div>
            <Input value={slug} onChange={(e: any) => setSlug(e.target.value.toLowerCase())} placeholder="z. B. firma" />
          </div>
          <div>
            <div style={{ fontSize: 14, marginBottom: 4 }}>Mandantenname</div>
            <Input value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Firmenname" />
          </div>
          <div>
            <div style={{ fontSize: 14, marginBottom: 4 }}>E-Mail</div>
            <Input value={email} onChange={(e: any) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div>
            <div style={{ fontSize: 14, marginBottom: 4 }}>Passwort</div>
            <Input type="password" value={password} onChange={(e: any) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
          <div style={{ display:'flex', justifyContent:'flex-end', gap: 8 }}>
            <Button type="submit" disabled={busy}>{busy ? 'Erstelle…' : 'Mandant registrieren'}</Button>
          </div>
        </div>
      </form>
    </Card>
  );
}


