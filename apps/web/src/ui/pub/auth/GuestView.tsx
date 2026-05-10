import { useTranslation } from 'react-i18next';

/* ---------- Props ---------- */

interface GuestViewProps {
  loading: boolean;
  error?: string | null;
  onBack: () => void;
}

/* ---------- Component ---------- */

export function GuestView({ loading, error, onBack }: GuestViewProps) {
  const { t } = useTranslation('public');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h2 className="pub-text-h4" style={{ margin: 0 }}>
        {t('auth.guestTitle')}
      </h2>

      {loading && (
        <div
          style={{
            textAlign: 'center',
            padding: '20px 0',
            color: 'var(--pub-text-secondary)',
          }}
        >
          {/* Simple spinner */}
          <div
            style={{
              width: 32,
              height: 32,
              border: '3px solid var(--pub-border-light)',
              borderTopColor: 'var(--pub-accent-purple)',
              borderRadius: '50%',
              animation: 'pub-spin 0.8s linear infinite',
              margin: '0 auto 12px',
            }}
          />
          <p className="pub-text-body" style={{ margin: 0 }}>
            {t('auth.guestLoading')}
          </p>
          <style>{`
            @keyframes pub-spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#EF4444',
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {!loading && (
        <p className="pub-text-body-sm" style={{ margin: 0, textAlign: 'center' }}>
          <button
            type="button"
            onClick={onBack}
            style={{
              all: 'unset',
              cursor: 'pointer',
              color: 'var(--pub-accent-purple)',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            {t('auth.backToLogin')}
          </button>
        </p>
      )}
    </div>
  );
}
