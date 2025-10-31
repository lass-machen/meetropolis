// React JSX runtime is configured via tsconfig

export type RosterItem = { identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string };

function formatLastSeen(lastSeen?: string): string {
  if (!lastSeen) return 'unbekannt';
  const ts = new Date(lastSeen).getTime();
  if (Number.isNaN(ts)) return 'unbekannt';
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `vor ${hrs} Std`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'gestern';
  if (days <= 30) return `vor ${days} Tagen`;
  return `> ${days} Tagen`;
}

export function RosterPanel(props: { roster: RosterItem[]; onJumpTo?: (item: RosterItem) => void }) {
  const { roster, onJumpTo } = props;
  return (
    <div style={{ width: 240, height: '100%', background: 'rgba(15,15,18,0.82)', borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontWeight: 800 }}>Team</div>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{roster.filter(r=>r.online).length} online</div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {roster.map(r => (
          <div key={r.identity} onDoubleClick={() => { if (!r.online) return; onJumpTo?.(r); }} style={{ display:'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: r.online ? 'pointer' : 'default' }}>
            <div style={{ width: 8, height: 8, borderRadius: 999, background: r.online ? '#22c55e' : '#6b7280', marginTop: 2 }} />
            <div style={{ display:'grid', gap: 2, minWidth: 0 }}>
              <div style={{ fontSize: 13, color:'#fff', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.name || r.identity}</div>
              <div style={{ fontSize: 11, color:'var(--fg-subtle)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                {r.online ? 'online' : formatLastSeen(r.lastSeen)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


