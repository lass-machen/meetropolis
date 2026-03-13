import React from 'react';
import { useTranslation } from 'react-i18next';
import { useZoneLockStore } from '../../state/zoneLockStore';

interface ZoneAccessPanelProps {
  colyseusRef: React.RefObject<any>;
  mySessionId: string;
  currentZone?: string | undefined;
}

export const ZoneAccessPanel = React.memo(function ZoneAccessPanel(props: ZoneAccessPanelProps) {
  const { colyseusRef, mySessionId, currentZone } = props;
  const { t } = useTranslation();
  const locks = useZoneLockStore(s => s.locks);

  // Finde Lock für aktuelle Zone, wo wir Zugang haben
  const currentLock = currentZone
    ? locks.find(l => l.zoneName === currentZone && l.accessList.includes(mySessionId))
    : undefined;

  const pendingRequests = currentLock?.pendingRequests || [];

  if (pendingRequests.length === 0) return null;

  const handleResponse = (sessionId: string, approved: boolean) => {
    const room = colyseusRef?.current;
    if (!room || !currentLock) return;
    room.send('zone_access_response', {
      zoneName: currentLock.zoneName,
      sessionId,
      approved,
    });
  };

  return (
    <div style={{
      position: 'absolute',
      top: 60,
      left: 12,
      background: 'var(--panel-bg)',
      color: 'var(--panel-fg)',
      padding: '10px 14px',
      borderRadius: 'var(--radius-sm, 8px)',
      fontSize: 11,
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255,255,255,0.12)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
      zIndex: 31,
      minWidth: 180,
      maxWidth: 260,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 12 }}>
        {t('zoneLock.accessRequests', 'Zugriffsanfragen')}
      </div>
      {pendingRequests.map((req) => (
        <div key={req.sessionId} style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '4px 0',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {req.name}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => handleResponse(req.sessionId, true)}
              style={{
                background: '#22c55e',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t('zoneLock.approve', 'OK')}
            </button>
            <button
              onClick={() => handleResponse(req.sessionId, false)}
              style={{
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t('zoneLock.deny', 'Nein')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});
