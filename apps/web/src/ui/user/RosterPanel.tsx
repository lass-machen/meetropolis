// React JSX runtime is configured via tsconfig

export type RosterItem = { identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string };

export function RosterPanel(props: { roster: RosterItem[]; onJumpTo?: (item: RosterItem) => void }) {
  const { roster, onJumpTo } = props;
  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 280, background: 'rgba(15,15,18,0.82)', borderLeft: '1px solid rgba(255,255,255,0.08)', zIndex: 40, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontWeight: 800 }}>Team</div>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{roster.filter(r=>r.online).length} online</div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {roster.map(r => (
          <div key={r.identity} onDoubleClick={() => { if (!r.online) return; onJumpTo?.(r); }} style={{ display:'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: r.online ? 'pointer' : 'default' }}>
            <div style={{ width: 10, height: 10, borderRadius: 999, background: r.online ? '#22c55e' : '#6b7280' }} />
            <div style={{ display:'grid', gap: 2 }}>
              <div style={{ fontSize: 13, color:'#fff' }}>{r.name || r.identity}</div>
              {!r.online && (
                <div style={{ fontSize: 11, color:'var(--fg-subtle)' }}>zuletzt online: {r.lastSeen ? new Date(r.lastSeen).toLocaleString() : 'unbekannt'}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


