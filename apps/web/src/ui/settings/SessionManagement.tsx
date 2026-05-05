import React from 'react';
import { useTranslation } from 'react-i18next';
import { getApiBaseFromWindow } from '../../lib/apiBase';
import { translateApiError } from '../../lib/apiErrors';
import { Button, Alert, Badge, Card, Divider } from '../system';

interface Session {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}

function detectDevice(ua: string): string {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android Phone' : 'Android Tablet';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Desktop';
}

function detectBrowser(ua: string, fallback: string): string {
  if (/Tauri/i.test(ua)) return 'Meetropolis Desktop';
  if (/Edg/i.test(ua)) return 'Edge';
  if (/Chrome/i.test(ua)) return 'Chrome';
  if (/Safari/i.test(ua)) return 'Safari';
  if (/Firefox/i.test(ua)) return 'Firefox';
  return fallback;
}

function parseUserAgent(ua: string | null, t: (k: string) => string): { device: string; browser: string } {
  if (!ua) return { device: t('sessions.unknownDevice'), browser: t('sessions.unknownBrowser') };
  return { device: detectDevice(ua), browser: detectBrowser(ua, t('sessions.unknownBrowser')) };
}

function formatRelativeDate(dateStr: string, t: (k: string, opts?: any) => string): string {
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return t('time.justNow');
  if (diff < 3600000) return t('time.minute', { count: Math.floor(diff / 60000) });
  if (diff < 86400000) return t('time.hour', { count: Math.floor(diff / 3600000) });
  if (diff < 604800000) return t('time.day', { count: Math.floor(diff / 86400000) });
  return date.toLocaleDateString();
}

function useSessionsApi(apiBase: string, t: (k: string, opts?: any) => string) {
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState<string | null>(null);

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

  React.useEffect(() => { fetchSessions(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const revokeSession = async (sessionId: string) => {
    if (!confirm(t('sessions.confirmRevoke'))) return;
    try {
      setRevoking(sessionId);
      const res = await fetch(`${apiBase}/auth/sessions/${sessionId}`, { method: 'DELETE', credentials: 'include' });
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
      const res = await fetch(`${apiBase}/auth/sessions`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
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

  return { sessions, loading, error, revoking, revokeSession, revokeAllOther };
}

function deviceEmoji(device: string): string {
  if (device.includes('Phone') || device === 'iPhone') return '📱';
  if (device.includes('Tablet') || device === 'iPad') return '📱';
  return '💻';
}

function SessionCard({ session, t, revoking, onRevoke }: { session: Session; t: (k: string, opts?: any) => string; revoking: string | null; onRevoke: (id: string) => void }) {
  const { device, browser } = parseUserAgent(session.userAgent, t);
  return (
    <Card style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 24 }}>{deviceEmoji(device)}</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
              {device}
              {session.isCurrent && <Badge intent="primary">{t('sessions.current')}</Badge>}
            </div>
            <div style={{ fontSize: 13, color: 'var(--fg-subtle, #888)' }}>{browser}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginLeft: 36 }}>
          {session.ipAddress && (<span style={{ fontSize: 12, color: 'var(--fg-subtle, #666)' }}>IP: {session.ipAddress}</span>)}
          <span style={{ fontSize: 12, color: 'var(--fg-subtle, #666)' }}>{t('sessions.lastActive')}: {formatRelativeDate(session.lastActiveAt, t)}</span>
          <span style={{ fontSize: 12, color: 'var(--fg-subtle, #666)' }}>{t('sessions.loggedIn')}: {formatRelativeDate(session.createdAt, t)}</span>
        </div>
      </div>
      {!session.isCurrent && (
        <Button variant="danger" onClick={() => onRevoke(session.id)} disabled={revoking === session.id || revoking === 'all'} style={{ fontSize: 13 }}>
          {revoking === session.id ? t('sessions.revoking') : t('sessions.revoke')}
        </Button>
      )}
    </Card>
  );
}

export function SessionManagement({ onClose: _onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const apiBase = getApiBaseFromWindow();
  const { sessions, loading, error, revoking, revokeSession, revokeAllOther } = useSessionsApi(apiBase, t);

  if (loading) {
    return (
      <div style={{ padding: '0 8px', color: 'var(--fg, #fff)' }}>
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-subtle, #888)' }}>
          {t('sessions.loading')}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '0 8px', color: 'var(--fg, #fff)' }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>{t('sessions.title')}</h2>
        <p style={{ fontSize: 14, color: 'var(--fg-subtle, #888)', margin: 0, lineHeight: 1.5 }}>{t('sessions.subtitle')}</p>
      </div>

      {error && <Alert intent="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      {sessions.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-subtle, #888)' }}>{t('sessions.noSessions')}</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sessions.map(session => (
              <SessionCard key={session.id} session={session} t={t} revoking={revoking} onRevoke={revokeSession} />
            ))}
          </div>

          {sessions.filter(s => !s.isCurrent).length > 0 && (
            <>
              <Divider />
              <Button variant="danger" onClick={revokeAllOther} disabled={revoking === 'all'} style={{ width: '100%' }}>
                {revoking === 'all' ? t('sessions.loggingOut') : t('sessions.logoutAllOther')}
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default SessionManagement;
