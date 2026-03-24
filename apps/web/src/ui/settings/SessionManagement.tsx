import React from 'react';
import { useTranslation } from 'react-i18next';
import { getApiBaseFromWindow } from '../../lib/apiBase';
import { translateApiError } from '../../lib/apiErrors';

interface Session {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export function SessionManagement({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState<string | null>(null);

  const apiBase = getApiBaseFromWindow();

  const fetchSessions = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${apiBase}/auth/sessions`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      } else {
        setError(t('sessions.loadFailed'));
      }
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)) || t('common.networkError'));
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchSessions();
  }, []);

  const revokeSession = async (sessionId: string) => {
    if (!confirm(t('sessions.confirmRevoke'))) return;

    try {
      setRevoking(sessionId);
      const res = await fetch(`${apiBase}/auth/sessions/${sessionId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setSessions(s => s.filter(sess => sess.id !== sessionId));
      } else {
        const data = await res.json().catch(() => ({}));
        setError(translateApiError(data.error) || t('sessions.revokeFailed'));
      }
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)) || t('common.networkError'));
    } finally {
      setRevoking(null);
    }
  };

  const revokeAllOther = async () => {
    if (!confirm(t('sessions.confirmRevokeAll'))) return;

    try {
      setRevoking('all');
      const res = await fetch(`${apiBase}/auth/sessions`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        // Keep only current session
        setSessions(s => s.filter(sess => sess.isCurrent));
        alert(t('sessions.revokedSuccess', { count: data.revokedCount || 0 }));
      } else {
        const data = await res.json().catch(() => ({}));
        setError(translateApiError(data.error) || t('sessions.revokeAllFailed'));
      }
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)) || t('common.networkError'));
    } finally {
      setRevoking(null);
    }
  };

  const parseUserAgent = (ua: string | null): { device: string; browser: string } => {
    if (!ua) return { device: t('sessions.unknownDevice'), browser: t('sessions.unknownBrowser') };

    let device = 'Desktop';
    let browser = t('sessions.unknownBrowser');

    // Device detection
    if (/iPhone/i.test(ua)) device = 'iPhone';
    else if (/iPad/i.test(ua)) device = 'iPad';
    else if (/Android/i.test(ua)) {
      device = /Mobile/i.test(ua) ? 'Android Phone' : 'Android Tablet';
    }
    else if (/Macintosh/i.test(ua)) device = 'Mac';
    else if (/Windows/i.test(ua)) device = 'Windows PC';
    else if (/Linux/i.test(ua)) device = 'Linux';

    // Browser detection
    if (/Tauri/i.test(ua)) browser = 'Meetropolis Desktop';
    else if (/Edg/i.test(ua)) browser = 'Edge';
    else if (/Chrome/i.test(ua)) browser = 'Chrome';
    else if (/Safari/i.test(ua)) browser = 'Safari';
    else if (/Firefox/i.test(ua)) browser = 'Firefox';

    return { device, browser };
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return t('time.justNow');
    if (diff < 3600000) return t('time.minute', { count: Math.floor(diff / 60000) });
    if (diff < 86400000) return t('time.hour', { count: Math.floor(diff / 3600000) });
    if (diff < 604800000) return t('time.day', { count: Math.floor(diff / 86400000) });

    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>{t('sessions.loading')}</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>{t('sessions.title')}</h2>
        <p style={styles.subtitle}>
          {t('sessions.subtitle')}
        </p>
      </div>

      {error && (
        <div style={styles.error}>{error}</div>
      )}

      {sessions.length === 0 ? (
        <div style={styles.empty}>{t('sessions.noSessions')}</div>
      ) : (
        <>
          <div style={styles.sessionList}>
            {sessions.map(session => {
              const { device, browser } = parseUserAgent(session.userAgent);
              return (
                <div key={session.id} style={styles.sessionCard}>
                  <div style={styles.sessionInfo}>
                    <div style={styles.deviceRow}>
                      <span style={styles.deviceIcon}>
                        {device.includes('Phone') || device === 'iPhone' ? '📱' :
                         device.includes('Tablet') || device === 'iPad' ? '📱' :
                         '💻'}
                      </span>
                      <div>
                        <div style={styles.deviceName}>
                          {device}
                          {session.isCurrent && (
                            <span style={styles.currentBadge}>{t('sessions.current')}</span>
                          )}
                        </div>
                        <div style={styles.browserName}>{browser}</div>
                      </div>
                    </div>
                    <div style={styles.sessionMeta}>
                      {session.ipAddress && (
                        <span style={styles.metaItem}>IP: {session.ipAddress}</span>
                      )}
                      <span style={styles.metaItem}>{t('sessions.lastActive')}: {formatDate(session.lastActiveAt)}</span>
                      <span style={styles.metaItem}>{t('sessions.loggedIn')}: {formatDate(session.createdAt)}</span>
                    </div>
                  </div>
                  {!session.isCurrent && (
                    <button
                      onClick={() => revokeSession(session.id)}
                      disabled={revoking === session.id || revoking === 'all'}
                      style={styles.revokeBtn}
                    >
                      {revoking === session.id ? t('sessions.revoking') : t('sessions.revoke')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {sessions.filter(s => !s.isCurrent).length > 0 && (
            <div style={styles.actions}>
              <button
                onClick={revokeAllOther}
                disabled={revoking === 'all'}
                style={styles.revokeAllBtn}
              >
                {revoking === 'all' ? t('sessions.loggingOut') : t('sessions.logoutAllOther')}
              </button>
            </div>
          )}
        </>
      )}

      <div style={styles.footer}>
        <button onClick={onClose} style={styles.closeBtn}>{t('modal.close')}</button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '0 8px',
    color: 'var(--fg, #fff)',
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    margin: '0 0 8px',
  },
  subtitle: {
    fontSize: 14,
    color: 'var(--fg-subtle, #888)',
    margin: 0,
    lineHeight: 1.5,
  },
  loading: {
    padding: 40,
    textAlign: 'center',
    color: 'var(--fg-subtle, #888)',
  },
  error: {
    padding: 12,
    marginBottom: 16,
    background: 'rgba(239, 68, 68, 0.15)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: 8,
    color: '#ef4444',
    fontSize: 14,
  },
  empty: {
    padding: 40,
    textAlign: 'center',
    color: 'var(--fg-subtle, #888)',
  },
  sessionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  sessionCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    background: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  sessionInfo: {
    flex: 1,
  },
  deviceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  deviceIcon: {
    fontSize: 24,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  currentBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 4,
    background: 'var(--accent, #3b82f6)',
    color: '#fff',
    textTransform: 'uppercase',
  },
  browserName: {
    fontSize: 13,
    color: 'var(--fg-subtle, #888)',
  },
  sessionMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px 16px',
    marginLeft: 36,
  },
  metaItem: {
    fontSize: 12,
    color: 'var(--fg-subtle, #666)',
  },
  revokeBtn: {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 500,
    background: 'rgba(239, 68, 68, 0.15)',
    color: '#ef4444',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: 6,
    cursor: 'pointer',
  },
  actions: {
    marginTop: 20,
    paddingTop: 20,
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
  },
  revokeAllBtn: {
    width: '100%',
    padding: '12px 20px',
    fontSize: 14,
    fontWeight: 500,
    background: 'rgba(239, 68, 68, 0.1)',
    color: '#ef4444',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    borderRadius: 8,
    cursor: 'pointer',
  },
  footer: {
    marginTop: 24,
    paddingTop: 20,
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
    display: 'flex',
    justifyContent: 'flex-end',
  },
  closeBtn: {
    padding: '10px 24px',
    fontSize: 14,
    fontWeight: 500,
    background: 'rgba(255, 255, 255, 0.1)',
    color: 'var(--fg, #fff)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: 8,
    cursor: 'pointer',
  },
};

export default SessionManagement;
