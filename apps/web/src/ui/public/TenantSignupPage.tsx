import React from 'react';
import { Button, Input, Card } from '../system';
import { ThemeToggleButton } from '../theme';

interface TenantSignupPageProps {
  apiBase: string;
  onBack: () => void;
  onSuccess: (tenantSlug: string) => void;
  selectedPlan?: string | undefined;
  registrationEnabled?: boolean;
}

export function TenantSignupPage({ apiBase, onBack, onSuccess, selectedPlan, registrationEnabled = true }: TenantSignupPageProps) {
  const [step, setStep] = React.useState<'form' | 'success'>('form');
  const [slug, setSlug] = React.useState('');
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [createdTenant, setCreatedTenant] = React.useState<{ slug: string; freeSeats: number } | null>(null);

  const slugPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

  const handleSlugChange = (value: string) => {
    // Only allow lowercase letters, numbers, and hyphens
    const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setSlug(cleaned);
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);

    // Validation
    if (!slug || !name || !email || !password) {
      setError('Please fill in all fields.');
      return;
    }

    if (slug.length < 2) {
      setError('Subdomain must be at least 2 characters.');
      return;
    }

    if (!slugPattern.test(slug)) {
      setError('Subdomain can only contain lowercase letters, numbers, and hyphens (not at start/end).');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/public/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ slug, name, email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'slug_exists') {
          throw new Error('This subdomain is already taken. Please choose another one.');
        }
        throw new Error(data.error || `Registration failed (HTTP ${res.status})`);
      }

      const data = await res.json();
      setCreatedTenant({ slug: data.tenant?.slug || slug, freeSeats: data.tenant?.freeSeats || 3 });
      setStep('success');
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      color: 'var(--fg)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 24px',
        maxWidth: 1200,
        margin: '0 auto',
        width: '100%',
      }}>
        <div
          onClick={onBack}
          style={{
            fontSize: 24,
            fontWeight: 800,
            background: 'var(--gradient-hero)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            cursor: 'pointer',
          }}
        >
          Meetropolis
        </div>
        <ThemeToggleButton />
      </header>

      {/* Content */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
      }}>
        {!registrationEnabled ? (
          <Card style={{ maxWidth: 480, width: '100%', padding: 32, textAlign: 'center' }}>
            <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 800 }}>
              Registrierung deaktiviert
            </h1>
            <p style={{ margin: '0 0 24px', color: 'var(--muted)' }}>
              Die öffentliche Registrierung ist derzeit nicht verfügbar.
              Bitte wenden Sie sich an den Administrator.
            </p>
            <Button variant="brand" onClick={onBack} style={{ padding: '14px 32px', fontSize: 16 }}>
              Zurück
            </Button>
          </Card>
        ) : step === 'form' ? (
          <Card style={{ maxWidth: 480, width: '100%', padding: 32 }}>
            <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 800 }}>
              Create Your Space
            </h1>
            <p style={{ margin: '0 0 24px', color: 'var(--muted)' }}>
              Set up your virtual office in seconds.
              {selectedPlan && selectedPlan !== 'free' && (
                <span style={{ display: 'block', marginTop: 4 }}>
                  Selected plan: <strong style={{ textTransform: 'capitalize' }}>{selectedPlan}</strong>
                </span>
              )}
            </p>

            <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                  Subdomain *
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                  <Input
                    value={slug}
                    onChange={(e: any) => handleSlugChange(e.target.value)}
                    placeholder="your-company"
                    style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
                  />
                  <div style={{
                    padding: '10px 12px',
                    background: 'var(--glass)',
                    border: '1px solid var(--border)',
                    borderLeft: 'none',
                    borderRadius: '0 8px 8px 0',
                    color: 'var(--muted)',
                    fontSize: 14,
                  }}>
                    .meetropolis.de
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  This will be your team's URL
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                  Organization Name *
                </label>
                <Input
                  value={name}
                  onChange={(e: any) => setName(e.target.value)}
                  placeholder="Acme Inc."
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                  Your Email *
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e: any) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                  Password *
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e: any) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                />
              </div>

              {error && (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  color: '#ef4444',
                  fontSize: 14,
                }}>
                  {error}
                </div>
              )}

              <Button
                type="submit"
                variant="brand"
                disabled={busy}
                style={{ width: '100%', padding: '14px 20px', fontSize: 16, marginTop: 8 }}
              >
                {busy ? 'Creating...' : 'Create Space'}
              </Button>

              <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', margin: 0 }}>
                By signing up, you agree to our Terms of Service and Privacy Policy.
              </p>
            </form>
          </Card>
        ) : (
          <Card style={{ maxWidth: 480, width: '100%', padding: 32, textAlign: 'center' }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'var(--success)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px',
              color: 'white',
              fontSize: 28,
            }}>
              <i className="fa-solid fa-check" />
            </div>
            <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 800 }}>
              Welcome to Meetropolis!
            </h1>
            <p style={{ margin: '0 0 24px', color: 'var(--muted)' }}>
              Your space <strong>{createdTenant?.slug}.meetropolis.de</strong> is ready.
              You have {createdTenant?.freeSeats || 3} free seats to get started.
            </p>
            <Button
              variant="brand"
              onClick={() => onSuccess(createdTenant?.slug || slug)}
              style={{ padding: '14px 32px', fontSize: 16 }}
            >
              Enter Your Space
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
