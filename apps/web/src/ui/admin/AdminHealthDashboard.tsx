import React from 'react';
import { getApiBaseFromWindow } from '../../lib/apiBase';

interface HealthData {
  timestamp: string;
  uptime: number;
  nodeVersion: string;
  platform: string;
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
  };
  database: {
    status: string;
    responseTime?: number;
    error?: string;
  };
  counts: {
    users?: number;
    tenants?: number;
    sessions?: number;
    memberships?: number;
    error?: string;
  };
  websocket: {
    status: string;
    activeRooms?: number;
    activeConnections?: number;
    error?: string;
  };
  livekit: {
    status: string;
    url?: string;
  };
  stripe: {
    status: string;
    webhookConfigured?: boolean;
  };
  email: {
    status: string;
    provider?: string;
  };
  onlineByTenant: Record<string, number>;
  totalOnline: number;
  responseTime: number;
}

interface StatsData {
  users: {
    total: number;
    last24h: number;
    last7d: number;
    last30d: number;
    verified: number;
    verificationRate: number;
  };
  tenants: {
    total: number;
    last24h: number;
    last7d: number;
    last30d: number;
  };
  sessions: {
    active: number;
  };
}

export function AdminHealthDashboard({ onClose }: { onClose: () => void }) {
  const [health, setHealth] = React.useState<HealthData | null>(null);
  const [stats, setStats] = React.useState<StatsData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = React.useState(false);

  const apiBase = getApiBaseFromWindow();

  const fetchData = async () => {
    try {
      setError(null);
      const [healthRes, statsRes] = await Promise.all([
        fetch(`${apiBase}/admin/health`, { credentials: 'include' }),
        fetch(`${apiBase}/admin/stats`, { credentials: 'include' }),
      ]);

      if (healthRes.ok) {
        setHealth(await healthRes.json());
      } else {
        setError('Failed to load health data');
      }

      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchData();
  }, []);

  React.useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 10000); // 10 seconds
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const color = status === 'connected' || status === 'ok' || status === 'configured'
      ? '#22c55e'
      : status === 'not_configured' || status === 'missing'
        ? '#f59e0b'
        : '#ef4444';
    return (
      <span style={{
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        background: `${color}20`,
        color,
      }}>
        {status}
      </span>
    );
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading system health...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>System Health</h2>
          {health && (
            <p style={styles.subtitle}>
              Last updated: {new Date(health.timestamp).toLocaleString()} ({health.responseTime}ms)
            </p>
          )}
        </div>
        <div style={styles.headerActions}>
          <label style={styles.autoRefreshLabel}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              style={styles.checkbox}
            />
            Auto-refresh (10s)
          </label>
          <button onClick={fetchData} style={styles.refreshBtn}>Refresh</button>
        </div>
      </div>

      {error && (
        <div style={styles.error}>{error}</div>
      )}

      {health && (
        <>
          {/* Server Info */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Server</h3>
            <div style={styles.grid}>
              <div style={styles.card}>
                <div style={styles.cardLabel}>Uptime</div>
                <div style={styles.cardValue}>{formatUptime(health.uptime)}</div>
              </div>
              <div style={styles.card}>
                <div style={styles.cardLabel}>Node Version</div>
                <div style={styles.cardValue}>{health.nodeVersion}</div>
              </div>
              <div style={styles.card}>
                <div style={styles.cardLabel}>Platform</div>
                <div style={styles.cardValue}>{health.platform}</div>
              </div>
              <div style={styles.card}>
                <div style={styles.cardLabel}>Online Users</div>
                <div style={styles.cardValue}>{health.totalOnline}</div>
              </div>
            </div>
          </div>

          {/* Memory */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Memory Usage</h3>
            <div style={styles.grid}>
              <div style={styles.card}>
                <div style={styles.cardLabel}>Heap Used</div>
                <div style={styles.cardValue}>{formatBytes(health.memory.heapUsed)}</div>
                <div style={styles.cardSubtext}>of {formatBytes(health.memory.heapTotal)}</div>
              </div>
              <div style={styles.card}>
                <div style={styles.cardLabel}>RSS</div>
                <div style={styles.cardValue}>{formatBytes(health.memory.rss)}</div>
              </div>
              <div style={styles.card}>
                <div style={styles.cardLabel}>External</div>
                <div style={styles.cardValue}>{formatBytes(health.memory.external)}</div>
              </div>
              <div style={styles.card}>
                <div style={styles.cardLabel}>Heap %</div>
                <div style={styles.cardValue}>
                  {Math.round((health.memory.heapUsed / health.memory.heapTotal) * 100)}%
                </div>
              </div>
            </div>
          </div>

          {/* Services */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Services</h3>
            <div style={styles.serviceGrid}>
              <div style={styles.serviceCard}>
                <div style={styles.serviceName}>Database</div>
                <StatusBadge status={health.database.status} />
                {health.database.responseTime && (
                  <div style={styles.serviceDetail}>{health.database.responseTime}ms</div>
                )}
              </div>
              <div style={styles.serviceCard}>
                <div style={styles.serviceName}>WebSocket</div>
                <StatusBadge status={health.websocket.status} />
                <div style={styles.serviceDetail}>
                  {health.websocket.activeRooms || 0} rooms, {health.websocket.activeConnections || 0} connections
                </div>
              </div>
              <div style={styles.serviceCard}>
                <div style={styles.serviceName}>LiveKit</div>
                <StatusBadge status={health.livekit.status} />
                {health.livekit.url && (
                  <div style={styles.serviceDetail}>{health.livekit.url}</div>
                )}
              </div>
              <div style={styles.serviceCard}>
                <div style={styles.serviceName}>Stripe</div>
                <StatusBadge status={health.stripe.status} />
                {health.stripe.webhookConfigured !== undefined && (
                  <div style={styles.serviceDetail}>
                    Webhook: {health.stripe.webhookConfigured ? 'yes' : 'no'}
                  </div>
                )}
              </div>
              <div style={styles.serviceCard}>
                <div style={styles.serviceName}>Email</div>
                <StatusBadge status={health.email.status} />
                {health.email.provider && (
                  <div style={styles.serviceDetail}>{health.email.provider}</div>
                )}
              </div>
            </div>
          </div>

          {/* Counts */}
          {health.counts && !health.counts.error && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Database Counts</h3>
              <div style={styles.grid}>
                <div style={styles.card}>
                  <div style={styles.cardLabel}>Users</div>
                  <div style={styles.cardValue}>{health.counts.users?.toLocaleString() || 0}</div>
                </div>
                <div style={styles.card}>
                  <div style={styles.cardLabel}>Tenants</div>
                  <div style={styles.cardValue}>{health.counts.tenants?.toLocaleString() || 0}</div>
                </div>
                <div style={styles.card}>
                  <div style={styles.cardLabel}>Sessions</div>
                  <div style={styles.cardValue}>{health.counts.sessions?.toLocaleString() || 0}</div>
                </div>
                <div style={styles.card}>
                  <div style={styles.cardLabel}>Memberships</div>
                  <div style={styles.cardValue}>{health.counts.memberships?.toLocaleString() || 0}</div>
                </div>
              </div>
            </div>
          )}

          {/* Online by Tenant */}
          {Object.keys(health.onlineByTenant).length > 0 && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Online by Tenant</h3>
              <div style={styles.tenantList}>
                {Object.entries(health.onlineByTenant).map(([tenant, count]) => (
                  <div key={tenant} style={styles.tenantItem}>
                    <span style={styles.tenantName}>{tenant}</span>
                    <span style={styles.tenantCount}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Stats Section */}
      {stats && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Growth Statistics</h3>
          <div style={styles.statsGrid}>
            <div style={styles.statsCard}>
              <div style={styles.statsTitle}>Users</div>
              <div style={styles.statsRow}>
                <span>Total</span>
                <span style={styles.statsValue}>{stats.users.total.toLocaleString()}</span>
              </div>
              <div style={styles.statsRow}>
                <span>Last 24h</span>
                <span style={styles.statsValue}>+{stats.users.last24h}</span>
              </div>
              <div style={styles.statsRow}>
                <span>Last 7d</span>
                <span style={styles.statsValue}>+{stats.users.last7d}</span>
              </div>
              <div style={styles.statsRow}>
                <span>Last 30d</span>
                <span style={styles.statsValue}>+{stats.users.last30d}</span>
              </div>
              <div style={styles.statsRow}>
                <span>Verified</span>
                <span style={styles.statsValue}>{stats.users.verificationRate}%</span>
              </div>
            </div>
            <div style={styles.statsCard}>
              <div style={styles.statsTitle}>Tenants</div>
              <div style={styles.statsRow}>
                <span>Total</span>
                <span style={styles.statsValue}>{stats.tenants.total.toLocaleString()}</span>
              </div>
              <div style={styles.statsRow}>
                <span>Last 24h</span>
                <span style={styles.statsValue}>+{stats.tenants.last24h}</span>
              </div>
              <div style={styles.statsRow}>
                <span>Last 7d</span>
                <span style={styles.statsValue}>+{stats.tenants.last7d}</span>
              </div>
              <div style={styles.statsRow}>
                <span>Last 30d</span>
                <span style={styles.statsValue}>+{stats.tenants.last30d}</span>
              </div>
            </div>
            <div style={styles.statsCard}>
              <div style={styles.statsTitle}>Sessions</div>
              <div style={styles.statsRow}>
                <span>Active</span>
                <span style={styles.statsValue}>{stats.sessions.active.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={styles.footer}>
        <button onClick={onClose} style={styles.closeBtn}>Close</button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '0 8px',
    color: 'var(--fg, #fff)',
    maxHeight: '70vh',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    margin: '0 0 4px',
  },
  subtitle: {
    fontSize: 12,
    color: 'var(--fg-subtle, #888)',
    margin: 0,
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  autoRefreshLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: 'var(--fg-subtle, #888)',
    cursor: 'pointer',
  },
  checkbox: {
    cursor: 'pointer',
  },
  refreshBtn: {
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 500,
    background: 'var(--accent, #3b82f6)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
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
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 12,
    color: 'var(--fg-subtle, #999)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
  },
  card: {
    padding: 16,
    background: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 10,
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  cardLabel: {
    fontSize: 12,
    color: 'var(--fg-subtle, #888)',
    marginBottom: 4,
  },
  cardValue: {
    fontSize: 20,
    fontWeight: 600,
  },
  cardSubtext: {
    fontSize: 11,
    color: 'var(--fg-subtle, #666)',
    marginTop: 2,
  },
  serviceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
  },
  serviceCard: {
    padding: 14,
    background: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 10,
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  serviceName: {
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 8,
  },
  serviceDetail: {
    fontSize: 11,
    color: 'var(--fg-subtle, #888)',
    marginTop: 6,
    wordBreak: 'break-all',
  },
  tenantList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  tenantItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    background: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 6,
  },
  tenantName: {
    fontSize: 13,
    fontWeight: 500,
  },
  tenantCount: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--accent, #3b82f6)',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
  },
  statsCard: {
    padding: 16,
    background: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 10,
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  statsTitle: {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  },
  statsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 13,
    color: 'var(--fg-subtle, #888)',
    padding: '4px 0',
  },
  statsValue: {
    fontWeight: 600,
    color: 'var(--fg, #fff)',
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

export default AdminHealthDashboard;
