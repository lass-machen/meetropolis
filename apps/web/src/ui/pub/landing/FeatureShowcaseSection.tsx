import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PubBadge } from '../components/PubBadge';
import { useReveal } from '../hooks/useReveal';

/* ---------- Feature row config ---------- */

interface FeatureRowData {
  numKey: string;
  titleKey: string;
  textKey: string;
  tagKeys: string[];
  /**
   * i18n key for the optional Feature-Showcase asset path. Brand-locale
   * supplies the actual `/images/pub/...`-URL; OSS-locale leaves it empty,
   * which causes the row to render text-only without a media element.
   */
  imageKey: string;
  isVideo?: boolean;
  accentColor: string;
  numberOpacity: string;
  imageBg: string;
  imageFirst: boolean;
}

const FEATURE_ROWS: FeatureRowData[] = [
  {
    numKey: 'features.feature1Num',
    titleKey: 'features.feature1Title',
    textKey: 'features.feature1Text',
    tagKeys: ['features.feature1Tag1', 'features.feature1Tag2'],
    imageKey: 'features.feature1Image',
    accentColor: 'var(--pub-accent-purple)',
    numberOpacity: 'rgba(139,92,246,0.19)',
    imageBg: '#EDE9FE',
    imageFirst: false,
  },
  {
    numKey: 'features.feature2Num',
    titleKey: 'features.feature2Title',
    textKey: 'features.feature2Text',
    tagKeys: ['features.feature2Tag1', 'features.feature2Tag2', 'features.feature2Tag3'],
    imageKey: 'features.feature2Image',
    isVideo: true,
    accentColor: 'var(--pub-accent-teal)',
    numberOpacity: 'rgba(20,184,166,0.19)',
    imageBg: '#CCFBF1',
    imageFirst: true,
  },
  {
    numKey: 'features.feature3Num',
    titleKey: 'features.feature3Title',
    textKey: 'features.feature3Text',
    tagKeys: ['features.feature3Tag1', 'features.feature3Tag2'],
    imageKey: 'features.feature3Image',
    accentColor: 'var(--pub-accent-pink)',
    numberOpacity: 'rgba(244,114,182,0.19)',
    imageBg: '#FCE7F3',
    imageFirst: false,
  },
  {
    numKey: 'features.feature4Num',
    titleKey: 'features.feature4Title',
    textKey: 'features.feature4Text',
    tagKeys: ['features.feature4Tag1', 'features.feature4Tag2', 'features.feature4Tag3'],
    imageKey: 'features.feature4Image',
    accentColor: 'var(--pub-accent-amber)',
    numberOpacity: 'rgba(245,158,11,0.19)',
    imageBg: '#FEF3C7',
    imageFirst: true,
  },
];

/* ---------- Single Feature Row ---------- */

function FeatureRowText({ row }: { row: FeatureRowData }) {
  const { t } = useTranslation('public');
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <span
        style={{
          fontFamily: 'var(--pub-font-display)',
          fontWeight: 800,
          fontSize: 72,
          lineHeight: 1,
          color: row.numberOpacity,
          display: 'block',
          marginBottom: 12,
        }}
      >
        {t(row.numKey)}
      </span>
      <h3 className="pub-text-h4" style={{ marginBottom: 16 }}>
        {t(row.titleKey)}
      </h3>
      <p
        className="pub-text-body"
        style={{
          color: 'var(--pub-text-secondary)',
          marginBottom: 20,
        }}
      >
        {t(row.textKey)}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {row.tagKeys.map((key) => (
          <span
            key={key}
            style={{
              background: 'var(--pub-bg-surface-hover)',
              borderRadius: 'var(--pub-radius-pill)',
              padding: '6px 14px',
              fontFamily: 'var(--pub-font-body)',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--pub-text-secondary)',
            }}
          >
            {t(key)}
          </span>
        ))}
      </div>
    </div>
  );
}

function FeatureRowImage({ row }: { row: FeatureRowData }) {
  const { t } = useTranslation('public');
  const rawSrc = t(row.imageKey);
  // i18next returns the key itself when no translation exists, so guard
  // against that — without a real path we render the placeholder background.
  const src = rawSrc && rawSrc !== row.imageKey ? rawSrc : '';
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        maxWidth: 520,
        aspectRatio: '520 / 360',
        borderRadius: 20,
        overflow: 'hidden',
        background: row.imageBg,
      }}
    >
      {!src ? null : row.isVideo ? (
        <video
          src={src}
          autoPlay
          loop
          muted
          playsInline
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        <img
          src={src}
          alt={t(row.titleKey)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      )}
    </div>
  );
}

function FeatureRow({ row }: { row: FeatureRowData }) {
  const rowRef = useRef<HTMLDivElement>(null);
  useReveal(rowRef);

  return (
    <div
      ref={rowRef}
      className="pub-reveal pub-feature-row"
      style={{ animationDelay: '0.1s' }}
    >
      {row.imageFirst ? (
        <>
          <div className="pub-feature-row__image"><FeatureRowImage row={row} /></div>
          <div className="pub-feature-row__text"><FeatureRowText row={row} /></div>
        </>
      ) : (
        <>
          <div className="pub-feature-row__text"><FeatureRowText row={row} /></div>
          <div className="pub-feature-row__image"><FeatureRowImage row={row} /></div>
        </>
      )}
    </div>
  );
}

const FEATURE_SHOWCASE_STYLES = `
  .pub-feature-row {
    display: flex;
    gap: 48px;
    align-items: center;
  }
  .pub-feature-row__text {
    flex: 1;
    min-width: 0;
  }
  .pub-feature-row__image {
    flex: 1;
    min-width: 0;
    display: flex;
    justify-content: center;
  }
  @media (max-width: 1024px) {
    .pub-feature-row {
      flex-direction: column !important;
      gap: 32px;
    }
    .pub-feature-row__text {
      order: 1;
    }
    .pub-feature-row__image {
      order: 2;
      width: 100%;
    }
    .pub-feature-row__image > div {
      max-width: 100% !important;
      width: 100%;
    }
  }
`;

/* ---------- Sub-Components ---------- */

function FeatureShowcaseHeader() {
  const { t } = useTranslation('public');
  return (
    <div style={{ textAlign: 'center', marginBottom: 64 }}>
      <div style={{ marginBottom: 24 }}>
        <PubBadge variant="purple">
          {t('features.badge')}
        </PubBadge>
      </div>
      <h2 className="pub-text-h2" style={{ marginBottom: 16 }}>
        {t('features.title')}
      </h2>
      <p
        className="pub-text-subline"
        style={{ maxWidth: 600, margin: '0 auto' }}
      >
        {t('features.subtitle')}
      </p>
    </div>
  );
}

function FeatureRowList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 80 }}>
      {FEATURE_ROWS.map((row) => (
        <FeatureRow key={row.numKey} row={row} />
      ))}
    </div>
  );
}

/* ---------- Section ---------- */

export function FeatureShowcaseSection() {
  const sectionRef = useRef<HTMLElement>(null);
  useReveal(sectionRef);

  return (
    <section
      id="features"
      ref={sectionRef}
      className="pub-reveal"
      style={{
        background: 'var(--pub-bg-surface)',
        padding: 'var(--pub-section-padding)',
      }}
    >
      <div className="pub-container">
        <FeatureShowcaseHeader />
        <FeatureRowList />
      </div>
      <style>{FEATURE_SHOWCASE_STYLES}</style>
    </section>
  );
}
