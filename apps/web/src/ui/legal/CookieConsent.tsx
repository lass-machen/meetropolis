import React from 'react';

const COOKIE_CONSENT_KEY = 'meetropolis_cookie_consent';

export function CookieConsent() {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!consent) {
      setVisible(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, 'accepted');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div style={styles.banner}>
      <div style={styles.content}>
        <p style={styles.text}>
          We use essential cookies for authentication and session management.
          These cookies are necessary for the service to function and cannot be disabled.
          By using this site, you accept our{' '}
          <a href="/#/privacy" style={styles.link}>Privacy Policy</a>.
        </p>
        <div style={styles.actions}>
          <button onClick={handleAccept} style={styles.acceptBtn}>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 99999,
    background: 'var(--glass, rgba(20,20,20,0.95))',
    borderTop: '1px solid var(--border, rgba(255,255,255,0.1))',
    backdropFilter: 'blur(8px)',
    padding: '12px 16px',
  },
  content: {
    maxWidth: 1200,
    margin: '0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap' as const,
  },
  text: {
    margin: 0,
    fontSize: 13,
    color: 'var(--fg-subtle, #aaa)',
    flex: 1,
    minWidth: 280,
  },
  link: {
    color: 'var(--accent, #3b82f6)',
    textDecoration: 'underline',
  },
  actions: {
    display: 'flex',
    gap: 8,
  },
  acceptBtn: {
    padding: '8px 20px',
    background: 'var(--accent, #3b82f6)',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
};

export default CookieConsent;
