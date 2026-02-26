import React from 'react';

export function BillingCancelPage({ onNavigate }: { onNavigate: () => void }) {
  React.useEffect(() => {
    const timer = setTimeout(onNavigate, 5000);
    return () => clearTimeout(timer);
  }, [onNavigate]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg, #0a0a0a)',
      color: 'var(--fg, #fff)',
    }}>
      <div style={{
        textAlign: 'center',
        padding: 40,
        background: 'rgba(255,255,255,0.05)',
        borderRadius: 16,
        maxWidth: 420,
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'rgba(234,179,8,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
          fontSize: 32, color: '#eab308',
        }}>&#10005;</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 600 }}>Checkout abgebrochen</h2>
        <p style={{ margin: '0 0 24px', color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
          Du kannst jederzeit ein Abonnement &uuml;ber das Billing-Dashboard abschlie&szlig;en.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={onNavigate}
            style={{
              padding: '10px 28px',
              background: 'var(--accent, #6366f1)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Zur App
          </button>
        </div>
      </div>
    </div>
  );
}
