import React from 'react';
import { ConnectionBanner } from '../../../ui/system/ConnectionBanner';

interface ConnectionBannersProps {
  isDev: boolean;
  connStatus: { reconnecting: boolean; lastCode?: number; lastReason?: string };
  showReloadBanner: boolean;
  onReload: () => void;
  onDismissBanner: () => void;
}

export function ConnectionBanners({
  isDev,
  connStatus,
  showReloadBanner,
  onReload,
  onDismissBanner,
}: ConnectionBannersProps) {
  return (
    <>
      {isDev && (
        <ConnectionBanner
          reconnecting={connStatus.reconnecting}
          reason={connStatus.lastReason ?? (typeof connStatus.lastCode === 'number' ? String(connStatus.lastCode) : '')}
        />
      )}

      {showReloadBanner && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 20px',
            borderRadius: 12,
            background: 'rgba(239, 68, 68, 0.95)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.2)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          <span>Verbindung zum Server verloren</span>
          <button
            onClick={onReload}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              background: 'rgba(255,255,255,0.2)',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Neu laden
          </button>
          <button
            onClick={onDismissBanner}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: 'none',
              background: 'transparent',
              color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
              fontSize: 16,
            }}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
