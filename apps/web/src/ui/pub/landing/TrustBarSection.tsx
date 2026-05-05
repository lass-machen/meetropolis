import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PubCard } from '../components/PubCard';
import { useReveal } from '../hooks/useReveal';

const ServerIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
    <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
    <line x1="6" x2="6.01" y1="6" y2="6" />
    <line x1="6" x2="6.01" y1="18" y2="18" />
  </svg>
);

const ShieldIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const FlagIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" x2="4" y1="22" y2="15" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" x2="12" y1="15" y2="3" />
  </svg>
);

interface ItemData {
  Icon: React.FC;
  iconBg: string;
  iconColor: string;
  titleKey: string;
  textKey: string;
}

const ITEMS: ItemData[] = [
  {
    Icon: ServerIcon,
    iconBg: 'var(--pub-icon-bg-purple)',
    iconColor: 'var(--pub-accent-purple)',
    titleKey: 'trustBar.item1Title',
    textKey: 'trustBar.item1Text',
  },
  {
    Icon: ShieldIcon,
    iconBg: 'var(--pub-icon-bg-teal)',
    iconColor: 'var(--pub-accent-teal)',
    titleKey: 'trustBar.item2Title',
    textKey: 'trustBar.item2Text',
  },
  {
    Icon: FlagIcon,
    iconBg: 'var(--pub-icon-bg-amber)',
    iconColor: 'var(--pub-accent-amber)',
    titleKey: 'trustBar.item3Title',
    textKey: 'trustBar.item3Text',
  },
  {
    Icon: DownloadIcon,
    iconBg: 'var(--pub-icon-bg-pink)',
    iconColor: 'var(--pub-accent-pink)',
    titleKey: 'trustBar.item4Title',
    textKey: 'trustBar.item4Text',
  },
];

const TRUST_BAR_STYLES = `
  .pub-trustbar-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }
  .pub-trustbar-card {
    width: calc(25% - 12px);
    min-width: 0;
    box-sizing: border-box;
  }
  .pub-trustbar-card__inner {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  @media (max-width: 1024px) {
    .pub-trustbar-card {
      width: calc(50% - 8px);
    }
  }
  @media (max-width: 600px) {
    .pub-trustbar-card {
      width: 100%;
    }
  }
`;

interface TrustItemCardProps {
  item: ItemData;
}

function TrustItemCard({ item }: TrustItemCardProps) {
  const { t } = useTranslation('public');
  const { Icon, iconBg, iconColor, titleKey, textKey } = item;
  return (
    <PubCard
      variant="surface"
      className="pub-trustbar-card"
      style={{ padding: 16 }}
    >
      <div className="pub-trustbar-card__inner">
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--pub-radius-icon)',
            background: iconBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: iconColor,
            flexShrink: 0,
          }}
        >
          <Icon />
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--pub-font-display)',
              fontWeight: 700,
              fontSize: 14,
              color: 'var(--pub-text-primary)',
              marginBottom: 2,
              lineHeight: 1.3,
            }}
          >
            {t(titleKey)}
          </div>
          <div
            style={{
              fontFamily: 'var(--pub-font-body)',
              fontSize: 13,
              color: 'var(--pub-text-secondary)',
              lineHeight: 1.4,
            }}
          >
            {t(textKey)}
          </div>
        </div>
      </div>
    </PubCard>
  );
}

export function TrustBarSection() {
  const sectionRef = useRef<HTMLElement>(null);
  useReveal(sectionRef);

  return (
    <section
      ref={sectionRef}
      className="pub-reveal"
      style={{
        background: 'var(--pub-bg-surface)',
        padding: '40px 24px',
        borderTop: '1px solid var(--pub-border-light)',
        borderBottom: '1px solid var(--pub-border-light)',
      }}
    >
      <div className="pub-container">
        <div className="pub-trustbar-grid">
          {ITEMS.map((item) => (
            <TrustItemCard key={item.titleKey} item={item} />
          ))}
        </div>
      </div>
      <style>{TRUST_BAR_STYLES}</style>
    </section>
  );
}
