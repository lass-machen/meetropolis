import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../system';
import { ThemeToggleButton } from '../theme';
import { getApiBaseFromWindow } from '../../lib/runtimeConfig';

interface LandingPageProps {
  onLogin: () => void;
  onSignup: () => void;
  onPricing: () => void;
  registrationEnabled?: boolean;
}

/* ═══════════════════════════════════════════════════════════════
   CSS injected via <style> for animations, hover effects,
   and responsive breakpoints (not possible with inline styles)
   ═══════════════════════════════════════════════════════════════ */
const globalStyles = `
@keyframes lp-fadeInUp {
  from { opacity: 0; transform: translateY(28px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes lp-pulse {
  0%, 100% { opacity: 0.35; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(1.05); }
}
@keyframes lp-shimmer {
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
}

/* Hero stagger animations */
.lp-stagger { animation: lp-fadeInUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) both; }
.lp-stagger-1 { animation-delay: 0.05s; }
.lp-stagger-2 { animation-delay: 0.15s; }
.lp-stagger-3 { animation-delay: 0.25s; }
.lp-stagger-4 { animation-delay: 0.35s; }

/* Scroll-triggered reveal */
.lp-reveal {
  opacity: 0;
  transform: translateY(28px);
  transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
}
.lp-reveal.lp-vis { opacity: 1; transform: translateY(0); }

/* Sticky header glass */
.lp-hdr {
  position: sticky; top: 0; z-index: 100;
  transition: background 0.3s, backdrop-filter 0.3s, box-shadow 0.3s;
}
.lp-hdr.lp-scrolled {
  background: var(--glass);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 1px 0 var(--border);
}

/* Card hover lift */
.lp-lift { transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s; }
.lp-lift:hover { transform: translateY(-3px); box-shadow: 0 12px 40px rgba(69, 13, 179, 0.12); }

/* Gradient border cards */
.lp-gcard {
  background: linear-gradient(var(--bg), var(--bg)) padding-box,
              linear-gradient(135deg, rgba(69, 13, 179, 0.25), rgba(243, 168, 20, 0.25)) border-box !important;
  border: 1px solid transparent !important;
}

/* Problem card warning hover */
.lp-warn:hover { border-color: rgba(239, 68, 68, 0.35) !important; }

/* FAQ hover */
.lp-faq-q { transition: color 0.2s; }
.lp-faq-q:hover { color: var(--brand-primary) !important; }

/* Comparison column highlight */
.lp-col-hl {
  background: linear-gradient(180deg, rgba(69,13,179,0.08) 0%, rgba(69,13,179,0.02) 100%);
  border-left: 2px solid var(--brand-primary);
  border-right: 2px solid var(--brand-primary);
}

/* Responsive */
@media (max-width: 768px) {
  .lp-g2 { grid-template-columns: 1fr !important; }
  .lp-g3 { grid-template-columns: 1fr !important; }
  .lp-g4 { grid-template-columns: 1fr 1fr !important; }
  .lp-pricing-g { grid-template-columns: 1fr !important; }
  .lp-trust { flex-direction: column !important; gap: 12px !important; align-items: center !important; }
  .lp-nav-mid { display: none !important; }
  .lp-stats { grid-template-columns: 1fr 1fr !important; }
  .lp-compare-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .lp-compare-inner { min-width: 640px; }
  .lp-footer-cols { flex-direction: column !important; gap: 24px !important; }
  .lp-sec { padding-left: 20px !important; padding-right: 20px !important; }
}
@media (max-width: 480px) {
  .lp-g4 { grid-template-columns: 1fr !important; }
  .lp-stats { grid-template-columns: 1fr 1fr !important; }
}
@media (min-width: 769px) and (max-width: 1024px) {
  .lp-pricing-g { grid-template-columns: 1fr 1fr !important; }
}
`;

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */
export function LandingPage({ onLogin, onSignup, onPricing, registrationEnabled = true }: LandingPageProps) {
  const { t } = useTranslation();
  const handleSignupClick = registrationEnabled ? onSignup : onLogin;

  const [scrolled, setScrolled] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Sticky header detection
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Scroll-triggered reveal animations
  useEffect(() => {
    const timer = setTimeout(() => {
      observerRef.current = new IntersectionObserver(
        (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('lp-vis'); }),
        { threshold: 0.08, rootMargin: '0px 0px -32px 0px' },
      );
      document.querySelectorAll('.lp-reveal').forEach((el) => observerRef.current!.observe(el));
    }, 80);
    return () => { clearTimeout(timer); observerRef.current?.disconnect(); };
  }, []);

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', overflowX: 'hidden' }}>
      <style>{globalStyles}</style>

      {/* ═══ HEADER ═══ */}
      <header className={`lp-hdr ${scrolled ? 'lp-scrolled' : ''}`} style={{ padding: '14px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: 1200, margin: '0 auto' }}>
          <div
            style={{ fontSize: 22, fontWeight: 800, background: 'var(--gradient)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.02em', cursor: 'pointer' }}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            Meetropolis
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div className="lp-nav-mid" style={{ display: 'flex', gap: 2, alignItems: 'center', marginRight: 8 }}>
              <Button variant="ghost" onClick={() => scrollTo('funktionen')} style={{ fontSize: 14 }}>{t('landing.nav.features')}</Button>
              <Button variant="ghost" onClick={onPricing} style={{ fontSize: 14 }}>{t('landing.nav.pricing')}</Button>
              <Button variant="ghost" onClick={() => scrollTo('download')} style={{ fontSize: 14 }}>{t('landing.nav.download')}</Button>
            </div>
            <ThemeToggleButton />
            <Button variant="ghost" onClick={onLogin} style={{ fontSize: 14 }}>Login</Button>
            {registrationEnabled && (
              <Button variant="brand" onClick={onSignup} style={{ fontSize: 14, padding: '8px 18px' }}>
                {t('landing.nav.cta')}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ═══ HERO ═══ */}
      <section style={{ position: 'relative', padding: '96px 24px 80px', textAlign: 'center', maxWidth: 960, margin: '0 auto' }}>
        {/* Decorative gradient orbs */}
        <div style={{ position: 'absolute', top: -140, left: -220, width: 520, height: 520, borderRadius: '50%', background: 'radial-gradient(circle, rgba(69,13,179,0.13) 0%, transparent 70%)', pointerEvents: 'none', animation: 'lp-pulse 7s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', bottom: -100, right: -200, width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(243,168,20,0.1) 0%, transparent 70%)', pointerEvents: 'none', animation: 'lp-pulse 7s ease-in-out infinite 3.5s' }} />

        {/* Badge */}
        <div className="lp-stagger lp-stagger-1" style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 16px', borderRadius: 24,
          background: 'var(--glass)', border: '1px solid var(--border)',
          fontSize: 13, fontWeight: 600, color: 'var(--muted)',
          marginBottom: 28, letterSpacing: '0.02em',
        }}>
          <i className="fa-solid fa-building" style={{ color: 'var(--brand-primary)', fontSize: 12 }} />
          {t('landing.hero.badge')}
        </div>

        {/* Headline */}
        <h1 className="lp-stagger lp-stagger-2" style={{
          fontSize: 'clamp(32px, 5.5vw, 58px)', fontWeight: 900,
          lineHeight: 1.08, letterSpacing: '-0.03em', marginBottom: 24,
        }}>
          {t('landing.hero.titleLine1')}{' '}
          <span style={{ background: 'var(--gradient-hero)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {t('landing.hero.titleLine2')}
          </span>
        </h1>

        {/* Subheadline */}
        <p className="lp-stagger lp-stagger-3" style={{
          fontSize: 'clamp(16px, 2vw, 19px)', color: 'var(--muted)',
          maxWidth: 640, margin: '0 auto 40px', lineHeight: 1.65,
        }}>
          {t('landing.hero.subtitle')}
        </p>

        {/* CTAs */}
        <div className="lp-stagger lp-stagger-4" style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 56 }}>
          <Button variant="brand" onClick={handleSignupClick} style={{ padding: '14px 32px', fontSize: 16, fontWeight: 700 }}>
            {registrationEnabled ? t('landing.hero.cta') : t('landing.hero.ctaLogin')}
            <i className="fa-solid fa-arrow-right" style={{ marginLeft: 8, fontSize: 14 }} />
          </Button>
          <Button variant="secondary" onClick={onPricing} style={{ padding: '14px 32px', fontSize: 16 }}>
            {t('landing.hero.ctaSecondary')}
          </Button>
        </div>

        {/* Trust Bar */}
        <div className="lp-stagger lp-stagger-4 lp-trust" style={{ display: 'flex', justifyContent: 'center', gap: 32, flexWrap: 'wrap' }}>
          {[
            { icon: 'fa-flag', textKey: 'landing.trust.hosting', color: 'var(--success, #22c55e)' },
            { icon: 'fa-shield-halved', textKey: 'landing.trust.gdpr', color: 'var(--brand-primary)' },
            { icon: 'fa-clock', textKey: 'landing.trust.trial', color: 'var(--brand-accent)' },
            { icon: 'fa-credit-card', textKey: 'landing.trust.noCreditCard', color: 'var(--muted)' },
          ].map((tb) => (
            <div key={tb.textKey} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted)' }}>
              <i className={`fa-solid ${tb.icon}`} style={{ color: tb.color, fontSize: 14 }} />
              {t(tb.textKey)}
            </div>
          ))}
        </div>
      </section>

      {/* ═══ PROBLEM ═══ */}
      <section className="lp-sec" style={{ padding: '88px 24px', maxWidth: 1200, margin: '0 auto' }}>
        <div className="lp-reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
          <Kicker>{t('landing.problem.kicker')}</Kicker>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            {t('landing.problem.title')}
          </h2>
        </div>

        <div className="lp-g2 lp-reveal" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {[
            { icon: 'fa-calendar-xmark', titleKey: 'landing.problem.meetingFatigue', textKey: 'landing.problem.meetingFatigueDesc' },
            { icon: 'fa-eye-slash', titleKey: 'landing.problem.invisibleColleagues', textKey: 'landing.problem.invisibleColleaguesDesc' },
            { icon: 'fa-people-arrows', titleKey: 'landing.problem.teamCulture', textKey: 'landing.problem.teamCultureDesc' },
            { icon: 'fa-puzzle-piece', titleKey: 'landing.problem.toolChaos', textKey: 'landing.problem.toolChaosDesc' },
          ].map((p) => (
            <div key={p.titleKey} className="lp-lift lp-warn" style={{
              padding: 28, borderRadius: 'var(--radius)',
              border: '1px solid var(--border)', background: 'var(--glass)',
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: 'rgba(239, 68, 68, 0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 16, fontSize: 18, color: 'var(--error, #ef4444)',
              }}>
                <i className={`fa-solid ${p.icon}`} />
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700 }}>{t(p.titleKey)}</h3>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>{t(p.textKey)}</p>
            </div>
          ))}
        </div>

        <p className="lp-reveal" style={{
          textAlign: 'center', marginTop: 36, fontSize: 15,
          color: 'var(--error, #ef4444)', opacity: 0.75,
          maxWidth: 680, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6,
        }}>
          {t('landing.problem.closing')}
        </p>
      </section>

      {/* ═══ TRANSFORMATION ═══ */}
      <section style={{
        padding: '88px 24px',
        background: 'var(--glass)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div className="lp-reveal" style={{ marginBottom: 48 }}>
            <Kicker>{t('landing.solution.kicker')}</Kicker>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              {t('landing.solution.title')}
            </h2>
          </div>

          <div style={{ display: 'grid', gap: 20 }}>
            {[
              { icon: 'fa-comments', textKey: 'landing.solution.item1' },
              { icon: 'fa-hand-wave', textKey: 'landing.solution.item2' },
              { icon: 'fa-eye', textKey: 'landing.solution.item3' },
              { icon: 'fa-building', textKey: 'landing.solution.item4' },
            ].map((item, i) => (
              <div key={i} className="lp-reveal" style={{
                display: 'flex', alignItems: 'flex-start', gap: 20,
                padding: '20px 24px', borderRadius: 'var(--radius)',
                background: i === 0 ? 'linear-gradient(135deg, rgba(69,13,179,0.06), rgba(243,168,20,0.03))' : 'transparent',
                border: `1px solid ${i === 0 ? 'rgba(69,13,179,0.12)' : 'transparent'}`,
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: 'var(--gradient)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, color: 'white', fontSize: 18,
                }}>
                  <i className={`fa-solid ${item.icon}`} />
                </div>
                <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, paddingTop: 10 }}>{t(item.textKey)}</p>
              </div>
            ))}
          </div>

          <div className="lp-reveal" style={{ marginTop: 44, textAlign: 'center' }}>
            <p style={{ fontSize: 20, fontWeight: 700, marginBottom: 28 }}>
              {t('landing.solution.closing')}
            </p>
            <Button variant="brand" onClick={handleSignupClick} style={{ padding: '14px 28px', fontSize: 16 }}>
              {registrationEnabled ? t('landing.solution.cta') : t('landing.hero.ctaLogin')}
              <i className="fa-solid fa-arrow-right" style={{ marginLeft: 8, fontSize: 14 }} />
            </Button>
          </div>
        </div>
      </section>

      {/* ═══ USPs ═══ */}
      <section className="lp-sec" style={{ padding: '100px 24px', maxWidth: 1200, margin: '0 auto' }}>
        <div className="lp-reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
          <Kicker>{t('landing.usps.kicker')}</Kicker>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            {t('landing.usps.title')}
          </h2>
        </div>

        <div className="lp-g2 lp-reveal" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {[
            { icon: 'fa-shield-halved', titleKey: 'landing.usps.dataInGermany', textKey: 'landing.usps.dataInGermanyDesc', color: '#22c55e' },
            { icon: 'fa-rocket', titleKey: 'landing.usps.noItProject', textKey: 'landing.usps.noItProjectDesc', color: 'var(--brand-accent)' },
            { icon: 'fa-desktop', titleKey: 'landing.usps.desktopApp', textKey: 'landing.usps.desktopAppDesc', color: '#60a5fa' },
            { icon: 'fa-layer-group', titleKey: 'landing.usps.allInOne', textKey: 'landing.usps.allInOneDesc', color: 'var(--brand-primary)' },
          ].map((u) => (
            <div key={u.titleKey} className="lp-gcard lp-lift" style={{ padding: 32, borderRadius: 'var(--radius)', background: 'var(--bg)' }}>
              <div style={{
                width: 52, height: 52, borderRadius: 14,
                background: `color-mix(in srgb, ${u.color} 12%, transparent)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 20, fontSize: 22, color: u.color,
              }}>
                <i className={`fa-solid ${u.icon}`} />
              </div>
              <h3 style={{ margin: '0 0 10px', fontSize: 19, fontWeight: 700 }}>{t(u.titleKey)}</h3>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 15, lineHeight: 1.6 }}>{t(u.textKey)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ FEATURES ═══ */}
      <section id="funktionen" className="lp-sec" style={{
        padding: '88px 24px',
        background: 'var(--glass)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div className="lp-reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
            <Kicker>{t('landing.features.kicker')}</Kicker>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              {t('landing.features.title')}
            </h2>
          </div>

          <div className="lp-g4 lp-reveal" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {[
              { icon: 'fa-volume-high', titleKey: 'landing.features.spatialAudio', textKey: 'landing.features.spatialAudioDesc' },
              { icon: 'fa-video', titleKey: 'landing.features.hdVideo', textKey: 'landing.features.hdVideoDesc' },
              { icon: 'fa-pen-ruler', titleKey: 'landing.features.mapEditor', textKey: 'landing.features.mapEditorDesc' },
              { icon: 'fa-lock', titleKey: 'landing.features.privateZones', textKey: 'landing.features.privateZonesDesc' },
              { icon: 'fa-robot', titleKey: 'landing.features.virtualAssistants', textKey: 'landing.features.virtualAssistantsDesc' },
              { icon: 'fa-users', titleKey: 'landing.features.teamOverview', textKey: 'landing.features.teamOverviewDesc' },
              { icon: 'fa-store', titleKey: 'landing.features.marketplace', textKey: 'landing.features.marketplaceDesc' },
              { icon: 'fa-sliders', titleKey: 'landing.features.remoteControl', textKey: 'landing.features.remoteControlDesc' },
            ].map((f) => (
              <div key={f.titleKey} className="lp-lift" style={{
                padding: 24, borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)', background: 'var(--bg)',
              }}>
                <i className={`fa-solid ${f.icon}`} style={{ color: 'var(--brand-primary)', fontSize: 20, marginBottom: 14, display: 'block' }} />
                <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700 }}>{t(f.titleKey)}</h3>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.55 }}>{t(f.textKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ COMPARISON ═══ */}
      <section className="lp-sec" style={{ padding: '100px 24px', maxWidth: 1000, margin: '0 auto' }}>
        <div className="lp-reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
          <Kicker>{t('landing.comparison.kicker')}</Kicker>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            {t('landing.comparison.title')}
          </h2>
        </div>

        <div className="lp-reveal lp-compare-wrap">
          <div className="lp-compare-inner" style={{ borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 1fr 1fr', borderBottom: '1px solid var(--border)' }}>
              <div style={{ padding: '16px 20px', background: 'var(--glass)' }} />
              <div className="lp-col-hl" style={{
                padding: '16px 20px', textAlign: 'center', fontWeight: 800, fontSize: 15,
                color: 'var(--brand-primary)', borderTop: '2px solid var(--brand-primary)',
              }}>
                Meetropolis
              </div>
              <div style={{ padding: '16px 20px', textAlign: 'center', fontWeight: 600, fontSize: 14, color: 'var(--muted)', background: 'var(--glass)' }}>Gather</div>
              <div style={{ padding: '16px 20px', textAlign: 'center', fontWeight: 600, fontSize: 14, color: 'var(--muted)', background: 'var(--glass)' }}>WorkAdventure</div>
            </div>

            {/* Rows */}
            {([
              [t('landing.comparison.hostingDE'), '\u2705', '\u274C US-Server', '\u274C Self-Host'],
              [t('landing.comparison.instantUse'), '\u2705 5 Min.', '\u2705', '\u274C IT-Projekt'],
              [t('landing.comparison.desktopApp'), '\u2705 Mini-Modus', '\u274C', '\u274C'],
              [t('landing.comparison.gdpr'), '\u2705', '\u274C', t('landing.comparison.selfResponsibility')],
              [t('landing.comparison.integratedEditor'), '\u2705 Autotile', '\u2705', '\u274C Extern'],
              [t('landing.comparison.virtualAssistants'), '\u2705', '\u274C', '\u274C'],
              [t('landing.comparison.germanSupport'), '\u2705 ' + t('landing.comparison.direct'), '\u274C Enterprise', '\u274C Community'],
            ]).map((row, i, arr) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '200px 1fr 1fr 1fr',
                borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{ padding: '13px 20px', fontSize: 14, fontWeight: 600 }}>{row[0]}</div>
                <div className="lp-col-hl" style={{
                  padding: '13px 20px', textAlign: 'center', fontSize: 14, fontWeight: 600,
                  color: row[1].includes('\u2705') ? 'var(--success, #22c55e)' : 'var(--fg)',
                }}>
                  {row[1]}
                </div>
                <div style={{ padding: '13px 20px', textAlign: 'center', fontSize: 14, color: 'var(--muted)' }}>{row[2]}</div>
                <div style={{ padding: '13px 20px', textAlign: 'center', fontSize: 14, color: 'var(--muted)' }}>{row[3]}</div>
              </div>
            ))}

            {/* Bottom border for Meetropolis column */}
            <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 1fr 1fr', height: 2 }}>
              <div /><div style={{ borderLeft: '2px solid var(--brand-primary)', borderRight: '2px solid var(--brand-primary)', borderBottom: '2px solid var(--brand-primary)' }} /><div /><div />
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SOCIAL PROOF ═══ */}
      <section style={{
        padding: '88px 24px',
        background: 'var(--glass)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div className="lp-reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              {t('landing.socialProof.title')}
            </h2>
          </div>

          {/* Testimonials */}
          <div className="lp-g3 lp-reveal" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 56 }}>
            {[
              { quoteKey: 'landing.socialProof.testimonial1', name: 'Sarah K.', role: 'Head of People', companyKey: 'landing.socialProof.company1' },
              { quoteKey: 'landing.socialProof.testimonial2', name: 'Marcus W.', role: 'CTO', companyKey: 'landing.socialProof.company2' },
              { quoteKey: 'landing.socialProof.testimonial3', name: 'Julia M.', role: 'COO', companyKey: 'landing.socialProof.company3' },
            ].map((tm) => (
              <div key={tm.name} className="lp-lift" style={{
                padding: 28, borderRadius: 'var(--radius)',
                border: '1px solid var(--border)', background: 'var(--bg)',
              }}>
                <div style={{ fontSize: 52, lineHeight: 1, color: 'var(--brand-primary)', opacity: 0.18, fontFamily: 'Georgia, serif', marginBottom: -4 }}>
                  &ldquo;
                </div>
                <p style={{ margin: '0 0 20px', fontSize: 15, lineHeight: 1.65, fontStyle: 'italic' }}>{t(tm.quoteKey)}</p>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{tm.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>{tm.role}, {t(tm.companyKey)}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Stats Bar */}
          <div className="lp-stats lp-reveal" style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20,
            padding: 32, borderRadius: 'var(--radius)', background: 'var(--gradient)',
          }}>
            {[
              { value: '500+', labelKey: 'landing.stats.activeUsers' },
              { value: '4.8/5', labelKey: 'landing.stats.rating' },
              { value: '<50ms', labelKey: 'landing.stats.latency' },
              { value: '99.9%', labelKey: 'landing.stats.uptime' },
            ].map((s) => (
              <div key={s.labelKey} style={{ textAlign: 'center', color: 'white' }}>
                <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.02em' }}>{s.value}</div>
                <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>{t(s.labelKey)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PRICING PREVIEW ═══ */}
      <section id="preise" className="lp-sec" style={{ padding: '100px 24px', maxWidth: 1200, margin: '0 auto' }}>
        <div className="lp-reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
          <Kicker>{t('landing.pricing.kicker')}</Kicker>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            {t('landing.pricing.title')}
          </h2>
        </div>

        <div className="lp-pricing-g lp-reveal" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, alignItems: 'stretch' }}>
          {([
            { name: 'Free', price: '0', periodKey: 'landing.pricing.forever', descKey: 'landing.pricing.freeDesc', featureKeys: ['landing.pricing.free3Users', 'landing.pricing.freeBasicAv', 'landing.pricing.freeStandardMap', 'landing.pricing.freeCommunitySupport'], ctaKey: 'landing.pricing.freeStartCta', hl: false },
            { name: 'Starter', price: '29', periodKey: 'landing.pricing.perMonth', descKey: 'landing.pricing.starterDesc', featureKeys: ['landing.pricing.starter10Users', 'landing.pricing.starterHdAv', 'landing.pricing.starterCustomMaps', 'landing.pricing.starterScreenshare', 'landing.pricing.starterEmailSupport'], ctaKey: 'landing.pricing.trialCta', hl: true },
            { name: 'Team', price: '79', periodKey: 'landing.pricing.perMonth', descKey: 'landing.pricing.teamDesc', featureKeys: ['landing.pricing.team50Users', 'landing.pricing.teamHdAv', 'landing.pricing.teamUnlimitedMaps', 'landing.pricing.teamPrivateZones', 'landing.pricing.teamAdminControl', 'landing.pricing.teamPrioritySupport'], ctaKey: 'landing.pricing.trialCta', hl: false },
            { name: 'Enterprise', price: t('landing.pricing.custom'), periodKey: '', descKey: 'landing.pricing.enterpriseDesc', featureKeys: ['landing.pricing.enterpriseUnlimitedUsers', 'landing.pricing.enterprise4k', 'landing.pricing.enterpriseSso', 'landing.pricing.enterpriseBranding', 'landing.pricing.enterpriseSla', 'landing.pricing.enterpriseDedicatedSupport', 'landing.pricing.enterpriseOnPremise'], ctaKey: 'landing.pricing.contactCta', hl: false },
          ]).map((plan) => (
            <div key={plan.name} style={{
              padding: 28, borderRadius: 'var(--radius)',
              border: plan.hl ? '2px solid var(--brand-primary)' : '1px solid var(--border)',
              background: plan.hl ? 'linear-gradient(180deg, rgba(69,13,179,0.06) 0%, var(--bg) 100%)' : 'var(--bg)',
              display: 'flex', flexDirection: 'column', position: 'relative',
            }}>
              {plan.hl && (
                <div style={{
                  position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)',
                  background: 'var(--gradient)', color: 'white',
                  padding: '4px 14px', borderRadius: 12, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                }}>
                  {t('landing.pricing.mostPopular')}
                </div>
              )}
              <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>{plan.name}</h3>
              <div style={{ marginBottom: 8 }}>
                {plan.name !== 'Enterprise' ? (
                  <>
                    <span style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.02em' }}>{plan.price}€</span>
                    <span style={{ color: 'var(--muted)', fontSize: 14 }}>{t(plan.periodKey)}</span>
                  </>
                ) : (
                  <span style={{ fontSize: 24, fontWeight: 700 }}>{t('landing.pricing.custom')}</span>
                )}
              </div>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>{t(plan.descKey)}</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', flex: 1 }}>
                {plan.featureKeys.map((fk) => (
                  <li key={fk} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13 }}>
                    <i className="fa-solid fa-check" style={{ color: 'var(--success, #22c55e)', fontSize: 11 }} />
                    {t(fk)}
                  </li>
                ))}
              </ul>
              <Button
                variant={plan.hl ? 'brand' : 'secondary'}
                onClick={() => {
                  if (plan.name === 'Enterprise') {
                    window.location.href = 'mailto:sales@meetropolis.de?subject=Enterprise%20Anfrage';
                  } else {
                    handleSignupClick();
                  }
                }}
                style={{ width: '100%' }}
              >
                {plan.name === 'Enterprise' ? t(plan.ctaKey) : (registrationEnabled ? t(plan.ctaKey) : t('landing.pricing.loginCta'))}
              </Button>
            </div>
          ))}
        </div>

        <div className="lp-reveal" style={{ textAlign: 'center', marginTop: 32 }}>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 16 }}>
            {t('landing.pricing.trialNote')}
          </p>
          <Button variant="ghost" onClick={onPricing} style={{ fontSize: 14 }}>
            {t('landing.pricing.allPricesDetail')}
            <i className="fa-solid fa-arrow-right" style={{ marginLeft: 8, fontSize: 12 }} />
          </Button>
        </div>
      </section>

      {/* ═══ RISK REVERSAL ═══ */}
      <section style={{
        padding: '72px 24px',
        background: 'var(--glass)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
      }}>
        <div className="lp-reveal" style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: 28, fontWeight: 800, marginBottom: 32, letterSpacing: '-0.02em' }}>
            {t('landing.riskReversal.title')}
          </h2>
          <div style={{ display: 'grid', gap: 16, textAlign: 'left' }}>
            {[
              'landing.riskReversal.freeTrial',
              'landing.riskReversal.noCreditCard',
              'landing.riskReversal.cancelAnytime',
              'landing.riskReversal.dataExport',
              'landing.riskReversal.germanSupport',
            ].map((key) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 16 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: 'rgba(34, 197, 94, 0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <i className="fa-solid fa-check" style={{ color: '#22c55e', fontSize: 13 }} />
                </div>
                {t(key)}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ DOWNLOAD ═══ */}
      <section id="download" className="lp-sec" style={{ padding: '100px 24px', maxWidth: 900, margin: '0 auto' }}>
        <div className="lp-reveal" style={{ textAlign: 'center', marginBottom: 48 }}>
          <Kicker>{t('landing.download.kicker')}</Kicker>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 16 }}>
            {t('landing.download.title')}
          </h2>
          <p style={{ color: 'var(--muted)', maxWidth: 560, margin: '0 auto', lineHeight: 1.65 }}>
            {t('landing.download.subtitle')}
          </p>
        </div>

        <div className="lp-reveal" style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
          <DownloadButton platform="macos" />
          <DownloadButton platform="windows" />
        </div>

        <div className="lp-reveal" style={{ textAlign: 'center', marginTop: 20, color: 'var(--muted)', fontSize: 13 }}>
          <DesktopVersionInfo />
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section className="lp-sec" style={{ padding: '100px 24px', maxWidth: 800, margin: '0 auto' }}>
        <div className="lp-reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            {t('landing.faq.title')}
          </h2>
        </div>

        <div className="lp-reveal">
          {[
            { qKey: 'landing.faq.q1', aKey: 'landing.faq.a1' },
            { qKey: 'landing.faq.q2', aKey: 'landing.faq.a2' },
            { qKey: 'landing.faq.q3', aKey: 'landing.faq.a3' },
            { qKey: 'landing.faq.q4', aKey: 'landing.faq.a4' },
            { qKey: 'landing.faq.q5', aKey: 'landing.faq.a5' },
            { qKey: 'landing.faq.q6', aKey: 'landing.faq.a6' },
            { qKey: 'landing.faq.q7', aKey: 'landing.faq.a7' },
            { qKey: 'landing.faq.q8', aKey: 'landing.faq.a8' },
          ].map((faq, i) => (
            <div key={i} style={{ borderBottom: '1px solid var(--border)' }}>
              <button
                className="lp-faq-q"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                style={{
                  all: 'unset', cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  width: '100%', padding: '20px 0',
                  fontWeight: 600, fontSize: 16, color: 'var(--fg)', boxSizing: 'border-box',
                }}
              >
                {t(faq.qKey)}
                <i className={`fa-solid fa-chevron-${openFaq === i ? 'up' : 'down'}`} style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0, marginLeft: 16 }} />
              </button>
              {openFaq === i && (
                <p style={{ margin: '0 0 20px', color: 'var(--muted)', lineHeight: 1.65, fontSize: 15, paddingRight: 40 }}>
                  {t(faq.aKey)}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section style={{ padding: '100px 24px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        {/* Background decoration */}
        <div style={{ position: 'absolute', inset: 0, background: 'var(--gradient)', opacity: 0.04, pointerEvents: 'none' }} />
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 600, height: 600, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(69,13,179,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div className="lp-reveal" style={{ position: 'relative', maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{ fontSize: 'clamp(32px, 5vw, 48px)', fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 16 }}>
            {t('landing.finalCta.title')}
          </h2>
          <p style={{ fontSize: 18, color: 'var(--muted)', marginBottom: 36, lineHeight: 1.6 }}>
            {t('landing.finalCta.subtitle')}
          </p>
          <Button variant="brand" onClick={handleSignupClick} style={{ padding: '16px 36px', fontSize: 17, fontWeight: 700 }}>
            {registrationEnabled ? t('landing.finalCta.cta') : t('landing.hero.ctaLogin')}
            <i className="fa-solid fa-arrow-right" style={{ marginLeft: 10, fontSize: 15 }} />
          </Button>
          <p style={{ marginTop: 20, fontSize: 14, color: 'var(--muted)' }}>
            {t('landing.finalCta.demoText')}{' '}
            <a href="mailto:info@meetropolis.de" style={{ color: 'var(--brand-primary)', textDecoration: 'none' }}>
              info@meetropolis.de
            </a>
          </p>
          <p style={{ marginTop: 40, fontSize: 13, color: 'var(--muted)', opacity: 0.65, fontStyle: 'italic' }}>
            {t('landing.finalCta.ps')}
          </p>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer style={{ padding: '48px 24px', borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div className="lp-footer-cols" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 32, marginBottom: 32 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, background: 'var(--gradient)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 8 }}>
                Meetropolis
              </div>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>{t('landing.footer.tagline')}</p>
            </div>
            <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>{t('landing.footer.product')}</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <FLink onClick={() => scrollTo('funktionen')}>{t('landing.nav.features')}</FLink>
                  <FLink onClick={onPricing}>{t('landing.nav.pricing')}</FLink>
                  <FLink onClick={() => scrollTo('download')}>{t('landing.footer.desktopApp')}</FLink>
                  <FLink href="https://github.com/lass-machen/meetropolis">GitHub</FLink>
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>{t('landing.footer.legal')}</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <FLink href="#/privacy">{t('landing.footer.privacy')}</FLink>
                  <FLink href="#/terms">{t('landing.footer.terms')}</FLink>
                  <FLink href="#/impressum">{t('landing.footer.imprint')}</FLink>
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>{t('landing.footer.contact')}</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <FLink href="mailto:support@meetropolis.de">{t('landing.footer.support')}</FLink>
                  <FLink href="mailto:sales@meetropolis.de">{t('landing.footer.sales')}</FLink>
                </div>
              </div>
            </div>
          </div>
          <div style={{ paddingTop: 24, borderTop: '1px solid var(--border)', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            {t('landing.footer.copyright')}
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'inline-block', fontSize: 13, fontWeight: 700,
      letterSpacing: '0.06em', textTransform: 'uppercase',
      color: 'var(--brand-primary)', marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function FLink({ children, href, onClick }: { children: React.ReactNode; href?: string; onClick?: () => void }) {
  if (onClick) {
    return (
      <button
        onClick={onClick}
        style={{ all: 'unset', cursor: 'pointer', fontSize: 13, color: 'var(--muted)', transition: 'color 0.2s' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--fg)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted)')}
      >
        {children}
      </button>
    );
  }
  return (
    <a
      href={href} target={href?.startsWith('http') ? '_blank' : undefined} rel={href?.startsWith('http') ? 'noopener' : undefined}
      style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none', transition: 'color 0.2s' }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--fg)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted)')}
    >
      {children}
    </a>
  );
}

function DownloadButton({ platform }: { platform: 'macos' | 'windows' }) {
  const { t } = useTranslation();
  const isCurrent = typeof navigator !== 'undefined' &&
    (platform === 'macos' ? /Mac/i.test(navigator.userAgent) : /Win/i.test(navigator.userAgent));

  const label = platform === 'macos' ? t('landing.download.macos') : t('landing.download.windows');
  const icon = platform === 'macos' ? 'fa-brands fa-apple' : 'fa-brands fa-windows';

  const handleClick = async () => {
    try {
      const res = await fetch(`${getApiBaseFromWindow()}/desktop/latest`);
      if (!res.ok) return;
      const data = await res.json();
      const asset = data.assets?.find((a: any) => a.platform === platform);
      if (asset?.url) {
        window.open(`${getApiBaseFromWindow()}${asset.url}`, '_blank');
      }
    } catch {
      // Silent fail — button becomes non-functional
    }
  };

  return (
    <button
      onClick={handleClick}
      className="lp-lift"
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '14px 28px',
        borderRadius: 12,
        fontWeight: 600,
        fontSize: 15,
        color: isCurrent ? '#fff' : 'var(--fg)',
        background: isCurrent ? 'var(--gradient)' : 'var(--glass)',
        border: isCurrent ? 'none' : '1px solid var(--border)',
        transition: 'transform 0.2s, box-shadow 0.2s',
        boxSizing: 'border-box',
      }}
    >
      <i className={icon} style={{ fontSize: 20 }} />
      {label}
    </button>
  );
}

function DesktopVersionInfo() {
  const [info, setInfo] = useState<{ version: string; date: string } | null>(null);

  useEffect(() => {
    fetch(`${getApiBaseFromWindow()}/desktop/latest`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.version) {
          setInfo({
            version: data.version,
            date: new Date(data.date).toLocaleDateString('de-DE', {
              day: 'numeric', month: 'long', year: 'numeric',
            }),
          });
        }
      })
      .catch(() => {});
  }, []);

  if (!info) return null;

  return <>Version {info.version} · {info.date}</>;
}
