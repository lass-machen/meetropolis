import React from 'react';
import { Button } from '../system';
import type { CatalogPack } from './packStoreTypes';
import { formatPrice, parseMajorVersion } from './packStoreTypes';
import { getApiBaseFromWindow } from '../../lib/runtimeConfig';

function resolveUrl(url: string): string {
  if (url.startsWith('/')) return `${getApiBaseFromWindow()}${url}`;
  return url;
}

interface PackCardProps {
  pack: CatalogPack;
  onInstall: (packUuid: string, packType: 'asset' | 'avatar') => void;
  onBuy: (packUuid: string, packType: 'asset' | 'avatar') => void;
}

type PackStatus = 'available' | 'installed' | 'expired' | 'upgrade';

function getPackStatus(pack: CatalogPack): PackStatus {
  if (!pack.access) return 'available';
  if (pack.access.revokedAt) return 'expired';
  if (pack.access.expiresAt && new Date(pack.access.expiresAt) < new Date()) return 'expired';
  const currentMajor = parseMajorVersion(pack.version);
  if (currentMajor > pack.access.purchasedMajorVersion) return 'upgrade';
  return 'installed';
}

function StatusBadge({ status }: { status: PackStatus }) {
  const config: Record<PackStatus, { label: string; bg: string; color: string }> = {
    available: { label: '', bg: '', color: '' },
    installed: { label: 'Installed', bg: 'rgba(34,197,94,0.15)', color: '#22c55e' },
    expired: { label: 'Expired', bg: 'rgba(239,68,68,0.15)', color: '#ef4444' },
    upgrade: { label: 'Upgrade Available', bg: 'rgba(234,179,8,0.15)', color: '#eab308' },
  };
  if (status === 'available') return null;
  const c = config[status];
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: c.bg, color: c.color, fontWeight: 600 }}>
      {c.label}
    </span>
  );
}

function PriceDisplay({ pack }: { pack: CatalogPack }) {
  if (pack.catalog.pricingModel === 'free') {
    return <span style={{ fontSize: 14, fontWeight: 700, color: '#22c55e' }}>Free</span>;
  }
  return (
    <span style={{ fontSize: 14, fontWeight: 700 }}>
      {formatPrice(pack.catalog.priceAmountCents, pack.catalog.priceCurrency, pack.catalog.priceInterval)}
    </span>
  );
}

function ActionButton({ pack, status, onInstall, onBuy }: PackCardProps & { status: PackStatus }) {
  if (status === 'installed') {
    return <Button disabled variant="secondary" style={{ width: '100%' }}>Installed</Button>;
  }
  if (status === 'upgrade') {
    return (
      <Button variant="primary" style={{ width: '100%' }} onClick={() => onBuy(pack.uuid, pack.packType)}>
        Upgrade
      </Button>
    );
  }
  if (pack.catalog.pricingModel === 'free') {
    return (
      <Button variant="primary" style={{ width: '100%' }} onClick={() => onInstall(pack.uuid, pack.packType)}>
        Install
      </Button>
    );
  }
  return (
    <Button variant="primary" style={{ width: '100%' }} onClick={() => onBuy(pack.uuid, pack.packType)}>
      Buy
    </Button>
  );
}

export function PackCard({ pack, onInstall, onBuy }: PackCardProps) {
  const status = getPackStatus(pack);

  return (
    <div style={cardStyle}>
      <div style={previewStyle}>
        {pack.catalog.previewImageUrl ? (
          <img src={resolveUrl(pack.catalog.previewImageUrl)} alt={pack.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={placeholderStyle}>
            <span style={{ fontSize: 28, opacity: 0.4 }}>{pack.packType === 'asset' ? '\uD83C\uDFAD' : '\uD83D\uDC64'}</span>
          </div>
        )}
        {pack.catalog.featured && (
          <span style={featuredBadgeStyle}>Featured</span>
        )}
      </div>
      <div style={{ padding: '10px 12px', display: 'grid', gap: 6, flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>{pack.name}</div>
            <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{pack.author}</div>
          </div>
          <StatusBadge status={status} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>v{pack.version}</span>
          <PriceDisplay pack={pack} />
        </div>
      </div>
      <div style={{ padding: '0 12px 12px' }}>
        <ActionButton pack={pack} status={status} onInstall={onInstall} onBuy={onBuy} />
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'var(--glass)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  transition: 'border-color 0.15s',
};

const previewStyle: React.CSSProperties = {
  width: '100%',
  height: 120,
  background: 'rgba(255,255,255,0.03)',
  position: 'relative',
  overflow: 'hidden',
};

const placeholderStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'grid',
  placeItems: 'center',
  background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(168,85,247,0.1))',
};

const featuredBadgeStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  fontSize: 10,
  fontWeight: 700,
  padding: '2px 8px',
  borderRadius: 6,
  background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-accent))',
  color: '#fff',
};
