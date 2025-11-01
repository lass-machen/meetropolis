// React JSX runtime is configured via tsconfig
import React from 'react';
import { FAIcon } from '../FAIcon';
export type RosterItem = { identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string };
import { useTranslation } from 'react-i18next';

export function RosterPanel(props: { roster: RosterItem[]; onJumpTo?: (item: RosterItem) => void }) {
  const { roster, onJumpTo } = props;
  const { t } = useTranslation();
  const [showOnline, setShowOnline] = React.useState(true);
  const [showOffline, setShowOffline] = React.useState(true);
  const formatLastSeen = React.useCallback((lastSeen?: string): string => {
    if (!lastSeen) return t('time.unknown');
    const ts = new Date(lastSeen).getTime();
    if (Number.isNaN(ts)) return t('time.unknown');
    const diffMs = Date.now() - ts;
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return t('time.justNow');
    if (min < 60) return t('time.minute', { count: min });
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return t('time.hour', { count: hrs });
    const days = Math.floor(hrs / 24);
    if (days === 1) return t('time.yesterday');
    if (days <= 30) return t('time.day', { count: days });
    return t('time.moreDays', { count: days });
  }, [t]);
  const online = (roster || []).filter(r => !!r.online).sort((a, b) => (a.name || a.identity).localeCompare(b.name || b.identity));
  const offline = (roster || []).filter(r => !r.online).sort((a, b) => (a.name || a.identity).localeCompare(b.name || b.identity));
  return (
    <div style={{ width: 240, height: '100%', background: 'rgba(15,15,18,0.82)', borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontWeight: 800 }}>{t('roster.team')}</div>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{online.length} {t('roster.onlineStatus')}</div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* Online Section */}
        {online.length > 0 && (
          <div>
            <div onClick={() => setShowOnline(v => !v)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding: '6px 12px', fontSize: 11, color: 'var(--fg-subtle)', letterSpacing: 0.4, textTransform: 'uppercase', cursor: 'pointer' }}>
              <div>{t('roster.onlineHeader')}</div>
              <FAIcon name={showOnline ? 'chevron-down' : 'chevron-right'} variant="solid" size="sm" ariaLabel={showOnline ? t('common.collapse') : t('common.expand')} />
            </div>
            {showOnline && online.map(r => (
              <div key={`on-${r.identity}`} onDoubleClick={() => { if (!r.online) return; onJumpTo?.(r); }} style={{ display:'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}>
                <div style={{ width: 8, height: 8, borderRadius: 999, background: '#22c55e', marginTop: 2 }} />
                <div style={{ display:'grid', gap: 2, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color:'#fff', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.name || r.identity}</div>
                  <div style={{ fontSize: 11, color:'var(--fg-subtle)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t('roster.onlineStatus')}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Offline Section */}
        {offline.length > 0 && (
          <div>
            <div onClick={() => setShowOffline(v => !v)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding: '6px 12px', fontSize: 11, color: 'var(--fg-subtle)', letterSpacing: 0.4, textTransform: 'uppercase', cursor: 'pointer' }}>
              <div>{t('roster.offlineHeader')}</div>
              <FAIcon name={showOffline ? 'chevron-down' : 'chevron-right'} variant="solid" size="sm" ariaLabel={showOffline ? t('common.collapse') : t('common.expand')} />
            </div>
            {showOffline && offline.map(r => (
              <div key={`off-${r.identity}`} style={{ display:'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ width: 8, height: 8, borderRadius: 999, background: '#6b7280', marginTop: 2 }} />
                <div style={{ display:'grid', gap: 2, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color:'#fff', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.name || r.identity}</div>
                  <div style={{ fontSize: 11, color:'var(--fg-subtle)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{formatLastSeen(r.lastSeen)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


