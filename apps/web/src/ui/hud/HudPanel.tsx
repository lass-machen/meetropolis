// Simple HUD panel showing zone, AV room, follow target and zone lock controls
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useZoneLockStore } from '../../state/zoneLockStore';
import type { WorldRoom } from '../../types/colyseus';

interface HudPanelProps {
  hud: { zone?: string; avRoom?: string | null; follow?: string | null };
  colyseusRef?: React.RefObject<WorldRoom | null> | undefined;
  mySessionId?: string | undefined;
}

export const HudPanel = React.memo(function HudPanel(props: HudPanelProps) {
  const { hud, colyseusRef, mySessionId } = props;
  const { t } = useTranslation();
  const locks = useZoneLockStore((s) => s.locks);

  // Only show when relevant info is available (not all "-" or "no")
  const hasZone = hud.zone && hud.zone !== '-';
  const hasFollow = hud.follow && hud.follow !== 'no';
  const showPanel = hasZone || hasFollow;

  if (!showPanel) return null;

  const currentLock = hasZone ? locks.find((l) => l.zoneName === hud.zone) : undefined;
  const isLocked = !!currentLock;
  const hasAccess = currentLock ? currentLock.accessList.includes(mySessionId || '') : true;
  const pendingCount = currentLock?.pendingRequests?.length || 0;

  const handleToggleLock = () => {
    const room = colyseusRef?.current;
    if (!room || !hasZone) return;
    if (isLocked && hasAccess) {
      room.send('zone_unlock', { zoneName: hud.zone });
    } else if (!isLocked) {
      room.send('zone_lock', { zoneName: hud.zone });
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        background: 'var(--panel-bg)',
        color: 'var(--panel-fg)',
        padding: '8px 12px',
        borderRadius: 'var(--radius-sm, 8px)',
        fontSize: 11,
        lineHeight: 1.6,
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 100,
      }}
    >
      {hasZone && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'rgba(229,231,235,0.5)', fontSize: 10 }}>{t('hud.zone')}</span>
          <span style={{ fontWeight: 600 }}>{hud.zone}</span>
          <button
            onClick={handleToggleLock}
            title={
              isLocked
                ? hasAccess
                  ? t('hud.unlockZone', 'Zone entsperren')
                  : t('hud.zoneLocked', 'Zone gesperrt')
                : t('hud.lockZone', 'Zone sperren')
            }
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: hasAccess ? 'pointer' : 'default',
              padding: '2px 4px',
              fontSize: 12,
              opacity: hasAccess ? 1 : 0.5,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {isLocked ? (
                <>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </>
              ) : (
                <>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                </>
              )}
            </svg>
            {pendingCount > 0 && hasAccess && (
              <span
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 8,
                  fontWeight: 700,
                  borderRadius: '50%',
                  width: 12,
                  height: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {pendingCount}
              </span>
            )}
          </button>
        </div>
      )}
      {hasFollow && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'rgba(229,231,235,0.5)', fontSize: 10 }}>{t('hud.following')}</span>
          <span style={{ fontWeight: 600, color: '#4ade80' }}>{hud.follow}</span>
        </div>
      )}
    </div>
  );
});
