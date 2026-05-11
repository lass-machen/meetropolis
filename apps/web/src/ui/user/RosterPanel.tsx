// React JSX runtime is configured via tsconfig
import React from 'react';
import { Icon } from '../Icon';
export type RosterItem = { identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string };
import { useTranslation } from 'react-i18next';

/**
 * Initials avatar using panel colors for a consistent look.
 * The panel is dark in both modes, so light text colors are used here.
 */
function Avatar({ name, online, size = 28 }: { name: string; online: boolean; size?: number }) {
  const initials = (name || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  // Subtle hue derived from the name.
  const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const bgColor = online ? `hsla(${hue}, 45%, 40%, 0.9)` : `hsla(${hue}, 15%, 28%, 0.7)`;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bgColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.38,
        fontWeight: 600,
        color: online ? 'var(--panel-fg, #e5e7eb)' : 'rgba(229,231,235,0.5)',
        flexShrink: 0,
        position: 'relative',
        border: `1px solid ${online ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)'}`,
      }}
    >
      {initials}
      {/* Online indicator. */}
      <div
        style={{
          position: 'absolute',
          bottom: -2,
          right: -2,
          width: size * 0.32,
          height: size * 0.32,
          borderRadius: '50%',
          background: online ? '#22c55e' : '#52525b',
          border: '2px solid var(--panel-bg, #0f1115)',
        }}
      />
    </div>
  );
}

function useFormatLastSeen() {
  const { t } = useTranslation();
  return React.useCallback(
    (lastSeen?: string): string => {
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
    },
    [t],
  );
}

function CollapsedRoster({
  online,
  onJumpTo,
  onToggleCollapse,
}: {
  online: RosterItem[];
  onJumpTo: ((item: RosterItem) => void) | undefined;
  onToggleCollapse: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        width: 44,
        height: '100%',
        background: 'var(--panel-bg)',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 10,
        gap: 6,
      }}
    >
      <button
        onClick={onToggleCollapse}
        aria-label={t('common.expand')}
        title={t('roster.team')}
        style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.06)',
          color: 'var(--panel-fg, #e5e7eb)',
          borderRadius: 'var(--radius-sm, 10px)',
          cursor: 'pointer',
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
        }}
      >
        <Icon name="users" size="sm" ariaLabel={t('roster.team')} />
      </button>
      <div
        style={{
          padding: '3px 6px',
          borderRadius: 10,
          background: online.length > 0 ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${online.length > 0 ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.08)'}`,
          fontSize: 10,
          fontWeight: 600,
          color: online.length > 0 ? '#4ade80' : 'rgba(229,231,235,0.6)',
        }}
      >
        {online.length}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          marginTop: 6,
          maxHeight: 'calc(100% - 90px)',
          overflow: 'hidden',
        }}
      >
        {online.slice(0, 4).map((r) => (
          <div
            key={r.identity}
            role="button"
            tabIndex={0}
            title={r.name || r.identity}
            onClick={() => onJumpTo?.(r)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onJumpTo?.(r);
              }
            }}
            style={{ cursor: 'pointer' }}
          >
            <Avatar name={r.name || r.identity} online={true} size={26} />
          </div>
        ))}
        {online.length > 4 && (
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              fontWeight: 600,
              color: 'rgba(229,231,235,0.6)',
            }}
          >
            +{online.length - 4}
          </div>
        )}
      </div>
    </div>
  );
}

function RosterHeader({
  onlineCount,
  totalCount,
  onToggleCollapse,
}: {
  onlineCount: number;
  totalCount: number;
  onToggleCollapse: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={onToggleCollapse}
          aria-label={t('common.collapse')}
          title={t('common.collapse')}
          style={{
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.06)',
            color: 'rgba(229,231,235,0.6)',
            borderRadius: 6,
            cursor: 'pointer',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
          }}
        >
          <Icon name="chevron-right" size="sm" ariaLabel={t('common.collapse')} />
        </button>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--panel-fg, #e5e7eb)' }}>{t('roster.team')}</span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 8px',
          borderRadius: 12,
          background: onlineCount > 0 ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${onlineCount > 0 ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.08)'}`,
        }}
      >
        <div
          style={{ width: 5, height: 5, borderRadius: '50%', background: onlineCount > 0 ? '#22c55e' : '#6b7280' }}
        />
        <span style={{ fontSize: 11, fontWeight: 600, color: onlineCount > 0 ? '#4ade80' : 'rgba(229,231,235,0.6)' }}>
          {onlineCount}/{totalCount}
        </span>
      </div>
    </div>
  );
}

function SectionToggle({
  label,
  expanded,
  onToggle,
  marginTop,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  marginTop?: number;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        cursor: 'pointer',
        userSelect: 'none',
        marginTop,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: 'rgba(229,231,235,0.6)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </span>
      <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size="sm" style={{ color: 'rgba(229,231,235,0.6)' }} />
    </div>
  );
}

function OnlineRow({
  r,
  hoveredId,
  setHoveredId,
  onJumpTo,
}: {
  r: RosterItem;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  onJumpTo: ((item: RosterItem) => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="button"
      tabIndex={0}
      onMouseEnter={() => setHoveredId(r.identity)}
      onMouseLeave={() => setHoveredId(null)}
      onClick={() => onJumpTo?.(r)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onJumpTo?.(r);
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        cursor: 'pointer',
        background: hoveredId === r.identity ? 'rgba(255,255,255,0.08)' : 'transparent',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        transition: 'background 0.1s ease',
      }}
    >
      <Avatar name={r.name || r.identity} online={true} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--panel-fg, #e5e7eb)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {r.name || r.identity}
        </div>
        <div style={{ fontSize: 10, color: '#4ade80' }}>{t('roster.onlineStatus')}</div>
      </div>
    </div>
  );
}

function OfflineRow({
  r,
  hoveredId,
  setHoveredId,
  formatLastSeen,
}: {
  r: RosterItem;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  formatLastSeen: (ls?: string) => string;
}) {
  return (
    <div
      onMouseEnter={() => setHoveredId(r.identity)}
      onMouseLeave={() => setHoveredId(null)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        background: hoveredId === r.identity ? 'rgba(255,255,255,0.03)' : 'transparent',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        transition: 'background 0.1s ease',
      }}
    >
      <Avatar name={r.name || r.identity} online={false} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'rgba(229,231,235,0.6)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {r.name || r.identity}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(229,231,235,0.35)' }}>{formatLastSeen(r.lastSeen)}</div>
      </div>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div style={{ padding: '30px 16px', textAlign: 'center', color: 'rgba(229,231,235,0.6)' }}>
      <Icon name="users" size="lg" style={{ marginBottom: 8, opacity: 0.4 }} />
      <div style={{ fontSize: 12 }}>{t('roster.noMembers')}</div>
    </div>
  );
}

function RosterSections({
  online,
  offline,
  hoveredId,
  setHoveredId,
  onJumpTo,
  formatLastSeen,
}: {
  online: RosterItem[];
  offline: RosterItem[];
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  onJumpTo: ((item: RosterItem) => void) | undefined;
  formatLastSeen: (ls?: string) => string;
}) {
  const { t } = useTranslation();
  const [showOnline, setShowOnline] = React.useState(true);
  const [showOffline, setShowOffline] = React.useState(true);
  return (
    <>
      {online.length > 0 && (
        <div>
          <SectionToggle
            label={t('roster.onlineHeader')}
            expanded={showOnline}
            onToggle={() => setShowOnline((v) => !v)}
          />
          {showOnline &&
            online.map((r) => (
              <OnlineRow
                key={`on-${r.identity}`}
                r={r}
                hoveredId={hoveredId}
                setHoveredId={setHoveredId}
                onJumpTo={onJumpTo}
              />
            ))}
        </div>
      )}
      {offline.length > 0 && (
        <div>
          <SectionToggle
            label={t('roster.offlineHeader')}
            expanded={showOffline}
            onToggle={() => setShowOffline((v) => !v)}
            marginTop={online.length > 0 ? 8 : 0}
          />
          {showOffline &&
            offline.map((r) => (
              <OfflineRow
                key={`off-${r.identity}`}
                r={r}
                hoveredId={hoveredId}
                setHoveredId={setHoveredId}
                formatLastSeen={formatLastSeen}
              />
            ))}
        </div>
      )}
      {online.length === 0 && offline.length === 0 && <EmptyState />}
    </>
  );
}

export function RosterPanel(props: {
  roster: RosterItem[];
  onJumpTo?: (item: RosterItem) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { roster, onJumpTo, collapsed, onToggleCollapse } = props;
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const formatLastSeen = useFormatLastSeen();

  const online = (roster || [])
    .filter((r) => !!r.online)
    .sort((a, b) => (a.name || a.identity).localeCompare(b.name || b.identity));
  const offline = (roster || [])
    .filter((r) => !r.online)
    .sort((a, b) => (a.name || a.identity).localeCompare(b.name || b.identity));
  const totalCount = roster?.length || 0;

  if (collapsed) {
    return <CollapsedRoster online={online} onJumpTo={onJumpTo} onToggleCollapse={onToggleCollapse} />;
  }

  return (
    <div
      style={{
        width: 240,
        height: '100%',
        background: 'var(--panel-bg)',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <RosterHeader onlineCount={online.length} totalCount={totalCount} onToggleCollapse={onToggleCollapse} />
      <div style={{ flex: 1, overflow: 'auto' }}>
        <RosterSections
          online={online}
          offline={offline}
          hoveredId={hoveredId}
          setHoveredId={setHoveredId}
          onJumpTo={onJumpTo}
          formatLastSeen={formatLastSeen}
        />
      </div>
    </div>
  );
}
