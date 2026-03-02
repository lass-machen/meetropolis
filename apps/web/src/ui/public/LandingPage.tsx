import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '../system';
import { ThemeToggleButton } from '../theme';

interface LandingPageProps {
  onLogin: () => void;
  onSignup: () => void;
  onPricing: () => void;
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
export function LandingPage({ onLogin, onSignup, onPricing }: LandingPageProps) {
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
              <Button variant="ghost" onClick={() => scrollTo('funktionen')} style={{ fontSize: 14 }}>Funktionen</Button>
              <Button variant="ghost" onClick={onPricing} style={{ fontSize: 14 }}>Preise</Button>
            </div>
            <ThemeToggleButton />
            <Button variant="ghost" onClick={onLogin} style={{ fontSize: 14 }}>Login</Button>
            <Button variant="brand" onClick={onSignup} style={{ fontSize: 14, padding: '8px 18px' }}>
              Kostenlos starten
            </Button>
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
          Virtuelles Büro für Remote Teams
        </div>

        {/* Headline */}
        <h1 className="lp-stagger lp-stagger-2" style={{
          fontSize: 'clamp(32px, 5.5vw, 58px)', fontWeight: 900,
          lineHeight: 1.08, letterSpacing: '-0.03em', marginBottom: 24,
        }}>
          Ihr Team arbeitet remote.{' '}
          <span style={{ background: 'var(--gradient-hero)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Aber fühlt es sich noch wie ein Team an?
          </span>
        </h1>

        {/* Subheadline */}
        <p className="lp-stagger lp-stagger-3" style={{
          fontSize: 'clamp(16px, 2vw, 19px)', color: 'var(--muted)',
          maxWidth: 640, margin: '0 auto 40px', lineHeight: 1.65,
        }}>
          Meetropolis gibt verteilten Teams das zurück, was Videocalls nicht können: spontane Gespräche, echte Präsenz und das Gefühl, gemeinsam an einem Ort zu sein.
        </p>

        {/* CTAs */}
        <div className="lp-stagger lp-stagger-4" style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 56 }}>
          <Button variant="brand" onClick={onSignup} style={{ padding: '14px 32px', fontSize: 16, fontWeight: 700 }}>
            Jetzt kostenlos starten
            <i className="fa-solid fa-arrow-right" style={{ marginLeft: 8, fontSize: 14 }} />
          </Button>
          <Button variant="secondary" onClick={onPricing} style={{ padding: '14px 32px', fontSize: 16 }}>
            Preise ansehen
          </Button>
        </div>

        {/* Trust Bar */}
        <div className="lp-stagger lp-stagger-4 lp-trust" style={{ display: 'flex', justifyContent: 'center', gap: 32, flexWrap: 'wrap' }}>
          {[
            { icon: 'fa-flag', text: 'Hosting in Deutschland', color: 'var(--success, #22c55e)' },
            { icon: 'fa-shield-halved', text: 'DSGVO-konform', color: 'var(--brand-primary)' },
            { icon: 'fa-clock', text: '14 Tage kostenlos', color: 'var(--brand-accent)' },
            { icon: 'fa-credit-card', text: 'Keine Kreditkarte nötig', color: 'var(--muted)' },
          ].map((t) => (
            <div key={t.text} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted)' }}>
              <i className={`fa-solid ${t.icon}`} style={{ color: t.color, fontSize: 14 }} />
              {t.text}
            </div>
          ))}
        </div>
      </section>

      {/* ═══ PROBLEM ═══ */}
      <section className="lp-sec" style={{ padding: '88px 24px', maxWidth: 1200, margin: '0 auto' }}>
        <div className="lp-reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
          <Kicker>Das Problem</Kicker>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            Remote-Arbeit hat eine Schattenseite.
          </h2>
        </div>

        <div className="lp-g2 lp-reveal" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {[
            { icon: 'fa-calendar-xmark', title: 'Meeting-Müdigkeit', text: 'Jedes Gespräch braucht einen Termin, einen Link, eine Einladung. Spontanität? Fehlanzeige.' },
            { icon: 'fa-eye-slash', title: 'Unsichtbare Kollegen', text: 'Wer ist gerade da? Wer ist ansprechbar? Niemand weiß es — bis man den Status checkt.' },
            { icon: 'fa-people-arrows', title: 'Teamkultur erodiert', text: 'Neue Mitarbeiter finden keinen Anschluss. Die Kaffeepause am Bildschirm funktioniert nicht.' },
            { icon: 'fa-puzzle-piece', title: 'Tool-Chaos', text: 'Slack, Zoom, Teams, Google Meet — für jeden Anlass ein anderes Tool. Keines ersetzt echte Nähe.' },
          ].map((p) => (
            <div key={p.title} className="lp-lift lp-warn" style={{
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
              <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700 }}>{p.title}</h3>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>{p.text}</p>
            </div>
          ))}
        </div>

        <p className="lp-reveal" style={{
          textAlign: 'center', marginTop: 36, fontSize: 15,
          color: 'var(--error, #ef4444)', opacity: 0.75,
          maxWidth: 680, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6,
        }}>
          Jede Woche ohne Lösung kostet nicht nur Produktivität — sie kostet Zusammenhalt, Innovation und gute Mitarbeiter.
        </p>
      </section>

      {/* ═══ TRANSFORMATION ═══ */}
      <section style={{
        padding: '88px 24px',
        background: 'var(--glass)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div className="lp-reveal" style={{ marginBottom: 48 }}>
            <Kicker>Die Lösung</Kicker>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              Stellen Sie sich vor...
            </h2>
          </div>

          <div style={{ display: 'grid', gap: 20 }}>
            {[
              { icon: 'fa-comments', text: 'Sie laufen zu einem Kollegen und fragen kurz etwas — ohne Meeting-Link.' },
              { icon: 'fa-hand-wave', text: 'Neue Mitarbeiter werden am Empfang begrüßt und finden sofort Anschluss.' },
              { icon: 'fa-eye', text: 'Ihr Team sieht auf einen Blick, wer da ist und wer nicht gestört werden will.' },
              { icon: 'fa-building', text: 'Das Büro-Gefühl ist zurück — ohne Pendeln, ohne Großraumbüro-Lärm.' },
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
                <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, paddingTop: 10 }}>{item.text}</p>
              </div>
            ))}
          </div>

          <div className="lp-reveal" style={{ marginTop: 44, textAlign: 'center' }}>
            <p style={{ fontSize: 20, fontWeight: 700, marginBottom: 28 }}>
              Genau das macht Meetropolis möglich. Ab heute.
            </p>
            <Button variant="brand" onClick={onSignup} style={{ padding: '14px 28px', fontSize: 16 }}>
              Jetzt ausprobieren
              <i className="fa-solid fa-arrow-right" style={{ marginLeft: 8, fontSize: 14 }} />
            </Button>
          </div>
        </div>
      </section>

      {/* ═══ USPs ═══ */}
      <section className="lp-sec" style={{ padding: '100px 24px', maxWidth: 1200, margin: '0 auto' }}>
        <div className="lp-reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
          <Kicker>Unsere Vorteile</Kicker>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            4 Gründe, warum Teams zu Meetropolis wechseln.
          </h2>
        </div>

        <div className="lp-g2 lp-reveal" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {[
            { icon: 'fa-shield-halved', title: 'Daten bleiben in Deutschland', text: 'Hosting in Deutschland, DSGVO-konform. Kein US-Cloud-Anbieter im Hintergrund. Ihre Daten gehören Ihnen.', color: '#22c55e' },
            { icon: 'fa-rocket', title: 'Kein IT-Projekt', text: 'Registrieren, Team einladen, loslegen. In 5 Minuten betriebsbereit. Kein Docker, kein DevOps.', color: 'var(--brand-accent)' },
            { icon: 'fa-desktop', title: 'Desktop-App mit Mini-Modus', text: 'Immer erreichbar, ohne Browsertab. Schwebendes Mini-Fenster für Mikrofon, Kamera und Status.', color: '#60a5fa' },
            { icon: 'fa-layer-group', title: 'Alles aus einer Hand', text: 'Karteneditor, Kommunikation, Verwaltung, Marketplace — kein Flickwerk aus Drittanbieter-Tools.', color: 'var(--brand-primary)' },
          ].map((u) => (
            <div key={u.title} className="lp-gcard lp-lift" style={{ padding: 32, borderRadius: 'var(--radius)', background: 'var(--bg)' }}>
              <div style={{
                width: 52, height: 52, borderRadius: 14,
                background: `color-mix(in srgb, ${u.color} 12%, transparent)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 20, fontSize: 22, color: u.color,
              }}>
                <i className={`fa-solid ${u.icon}`} />
              </div>
              <h3 style={{ margin: '0 0 10px', fontSize: 19, fontWeight: 700 }}>{u.title}</h3>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 15, lineHeight: 1.6 }}>{u.text}</p>
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
            <Kicker>Funktionen</Kicker>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              Alles, was Ihr virtuelles Büro braucht.
            </h2>
          </div>

          <div className="lp-g4 lp-reveal" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {[
              { icon: 'fa-volume-high', title: 'Räumliches Audio', text: 'Näherkommen = Hören. Weggehen = Stille. Wie im echten Büro.' },
              { icon: 'fa-video', title: 'HD Video & Screenshare', text: 'Kristallklare Qualität. Ein Klick für Bildschirmfreigabe.' },
              { icon: 'fa-pen-ruler', title: 'Karteneditor', text: 'Gestalten Sie Ihr Büro selbst. Räume, Möbel, Zonen — direkt im Browser.' },
              { icon: 'fa-lock', title: 'Private Zonen', text: 'Meeting-Räume mit Schallschutz und optionaler Kapazitätsbegrenzung.' },
              { icon: 'fa-robot', title: 'Virtuelle Assistenten', text: 'Empfangs-Bots, Info-Stationen, automatische Ankündigungen.' },
              { icon: 'fa-users', title: 'Team-Übersicht', text: 'Wer ist online? Ein Klick — sofort beim Kollegen.' },
              { icon: 'fa-store', title: 'Marketplace', text: 'Möbel, Avatare, Themes. Ihr Büro wächst mit Ihnen.' },
              { icon: 'fa-sliders', title: 'Fernsteuerung', text: 'Mikrofon, Kamera, Status per API steuerbar (Stream Deck, Kalender).' },
            ].map((f) => (
              <div key={f.title} className="lp-lift" style={{
                padding: 24, borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)', background: 'var(--bg)',
              }}>
                <i className={`fa-solid ${f.icon}`} style={{ color: 'var(--brand-primary)', fontSize: 20, marginBottom: 14, display: 'block' }} />
                <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700 }}>{f.title}</h3>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.55 }}>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ COMPARISON ═══ */}
      <section className="lp-sec" style={{ padding: '100px 24px', maxWidth: 1000, margin: '0 auto' }}>
        <div className="lp-reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
          <Kicker>Vergleich</Kicker>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            Meetropolis vs. Alternativen
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
              ['Hosting in Deutschland', '\u2705', '\u274C US-Server', '\u274C Self-Host'],
              ['Sofort nutzbar', '\u2705 5 Min.', '\u2705', '\u274C IT-Projekt'],
              ['Desktop-App', '\u2705 Mini-Modus', '\u274C', '\u274C'],
              ['DSGVO-konform', '\u2705', '\u274C', 'Eigenverantwortung'],
              ['Integrierter Editor', '\u2705 Autotile', '\u2705', '\u274C Extern'],
              ['Virtuelle Assistenten', '\u2705', '\u274C', '\u274C'],
              ['Deutscher Support', '\u2705 Direkt', '\u274C Enterprise', '\u274C Community'],
            ] as const).map((row, i, arr) => (
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
              Teams vertrauen auf Meetropolis
            </h2>
          </div>

          {/* Testimonials */}
          <div className="lp-g3 lp-reveal" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 56 }}>
            {[
              { quote: 'Seit wir Meetropolis nutzen, fühlt sich Remote-Arbeit nicht mehr einsam an. Die spontanen Gespräche sind Gold wert.', name: 'Sarah K.', role: 'Head of People', company: 'SaaS-Startup, 42 Mitarbeiter' },
              { quote: 'Wir haben Gather, WorkAdventure und Teams ausprobiert. Meetropolis war das einzige Tool, bei dem Datenschutz kein Kompromiss war.', name: 'Marcus W.', role: 'CTO', company: 'FinTech-Unternehmen' },
              { quote: 'Unsere Onboarding-Zeit hat sich halbiert. Neue Mitarbeiter finden durch das virtuelle Büro sofort Anschluss.', name: 'Julia M.', role: 'COO', company: 'Beratungsgesellschaft' },
            ].map((t) => (
              <div key={t.name} className="lp-lift" style={{
                padding: 28, borderRadius: 'var(--radius)',
                border: '1px solid var(--border)', background: 'var(--bg)',
              }}>
                <div style={{ fontSize: 52, lineHeight: 1, color: 'var(--brand-primary)', opacity: 0.18, fontFamily: 'Georgia, serif', marginBottom: -4 }}>
                  &ldquo;
                </div>
                <p style={{ margin: '0 0 20px', fontSize: 15, lineHeight: 1.65, fontStyle: 'italic' }}>{t.quote}</p>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t.role}, {t.company}</div>
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
              { value: '500+', label: 'Aktive Nutzer' },
              { value: '4.8/5', label: 'Bewertung' },
              { value: '<50ms', label: 'Latenz' },
              { value: '99.9%', label: 'Uptime' },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: 'center', color: 'white' }}>
                <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.02em' }}>{s.value}</div>
                <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PRICING PREVIEW ═══ */}
      <section id="preise" className="lp-sec" style={{ padding: '100px 24px', maxWidth: 1200, margin: '0 auto' }}>
        <div className="lp-reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
          <Kicker>Preise</Kicker>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            Transparent. Fair. Ohne Überraschungen.
          </h2>
        </div>

        <div className="lp-pricing-g lp-reveal" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, alignItems: 'stretch' }}>
          {([
            { name: 'Free', price: '0', period: 'für immer', desc: '3 Nutzer, perfekt zum Testen', features: ['3 gleichzeitige Nutzer', 'Basis Audio/Video', 'Standard-Map', 'Community Support'], cta: 'Kostenlos starten', hl: false },
            { name: 'Starter', price: '29', period: '/Monat', desc: '10 Nutzer, HD Video, Custom Maps', features: ['10 gleichzeitige Nutzer', 'HD Audio/Video', 'Eigene Maps', 'Bildschirmfreigabe', 'E-Mail Support'], cta: '14 Tage testen', hl: true },
            { name: 'Team', price: '79', period: '/Monat', desc: '50 Nutzer, Private Zonen, Admin', features: ['50 gleichzeitige Nutzer', 'HD Audio/Video', 'Unbegrenzte Maps', 'Private Zonen', 'Admin-Kontrolle', 'Prioritäts-Support'], cta: '14 Tage testen', hl: false },
            { name: 'Enterprise', price: 'Individuell', period: '', desc: 'Unbegrenzt, SSO, On-Premise', features: ['Unbegrenzte Nutzer', '4K Video', 'SSO / SAML', 'Custom Branding', 'SLA-Garantie', 'Dedizierter Support', 'On-Premise Option'], cta: 'Kontakt aufnehmen', hl: false },
          ] as const).map((plan) => (
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
                  Beliebtester Plan
                </div>
              )}
              <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>{plan.name}</h3>
              <div style={{ marginBottom: 8 }}>
                {plan.price !== 'Individuell' ? (
                  <>
                    <span style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.02em' }}>{plan.price}€</span>
                    <span style={{ color: 'var(--muted)', fontSize: 14 }}>{plan.period}</span>
                  </>
                ) : (
                  <span style={{ fontSize: 24, fontWeight: 700 }}>Individuell</span>
                )}
              </div>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>{plan.desc}</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', flex: 1 }}>
                {plan.features.map((f) => (
                  <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13 }}>
                    <i className="fa-solid fa-check" style={{ color: 'var(--success, #22c55e)', fontSize: 11 }} />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                variant={plan.hl ? 'brand' : 'secondary'}
                onClick={() => {
                  if (plan.name === 'Enterprise') {
                    window.location.href = 'mailto:sales@meetropolis.de?subject=Enterprise%20Anfrage';
                  } else {
                    onSignup();
                  }
                }}
                style={{ width: '100%' }}
              >
                {plan.cta}
              </Button>
            </div>
          ))}
        </div>

        <div className="lp-reveal" style={{ textAlign: 'center', marginTop: 32 }}>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 16 }}>
            14 Tage kostenlos testen. Keine Kreditkarte nötig. Jederzeit kündbar.
          </p>
          <Button variant="ghost" onClick={onPricing} style={{ fontSize: 14 }}>
            Alle Preise im Detail
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
            Kein Risiko. Versprochen.
          </h2>
          <div style={{ display: 'grid', gap: 16, textAlign: 'left' }}>
            {[
              '14 Tage kostenlos — voller Funktionsumfang',
              'Keine Kreditkarte zum Start',
              'Jederzeit kündbar — monatlich, keine Bindung',
              'Datenexport garantiert — Ihre Daten gehören Ihnen',
              'Deutscher Support — echte Menschen, keine Chatbots',
            ].map((txt) => (
              <div key={txt} style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 16 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: 'rgba(34, 197, 94, 0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <i className="fa-solid fa-check" style={{ color: '#22c55e', fontSize: 13 }} />
                </div>
                {txt}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section className="lp-sec" style={{ padding: '100px 24px', maxWidth: 800, margin: '0 auto' }}>
        <div className="lp-reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            Häufige Fragen
          </h2>
        </div>

        <div className="lp-reveal">
          {[
            { q: 'Was zählt als "gleichzeitiger Nutzer"?', a: 'Nur wer gerade online ist. 10 Teammitglieder, aber nur 5 gleichzeitig online? Dann reicht Kapazität für 5.' },
            { q: 'Brauche ich IT-Ressourcen für die Einrichtung?', a: 'Nein. Registrieren, Team einladen, fertig. Kein Server, kein Docker, kein DevOps.' },
            { q: 'Wo werden meine Daten gespeichert?', a: 'In Deutschland. DSGVO-konform, mit Datenexport und Account-Löschung auf Knopfdruck.' },
            { q: 'Kann ich jederzeit den Plan wechseln?', a: 'Ja, hoch- und runterstufen ist jederzeit möglich. Anteilige Abrechnung beim Upgrade.' },
            { q: 'Gibt es einen kostenlosen Test?', a: 'Alle Bezahlpläne haben 14 Tage kostenlose Testphase. Der Free-Plan ist dauerhaft kostenlos.' },
            { q: 'Wie ist die Audio-/Videoqualität?', a: 'Enterprise-Qualität durch LiveKit (WebRTC). HD Video, räumliches Audio, automatische Rauschunterdrückung.' },
            { q: 'Was passiert, wenn ich kündige?', a: 'Ihre Daten bleiben 30 Tage erhalten. Export jederzeit möglich. Keine Kündigungsfrist.' },
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
                {faq.q}
                <i className={`fa-solid fa-chevron-${openFaq === i ? 'up' : 'down'}`} style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0, marginLeft: 16 }} />
              </button>
              {openFaq === i && (
                <p style={{ margin: '0 0 20px', color: 'var(--muted)', lineHeight: 1.65, fontSize: 15, paddingRight: 40 }}>
                  {faq.a}
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
            Ihr virtuelles Büro wartet.
          </h2>
          <p style={{ fontSize: 18, color: 'var(--muted)', marginBottom: 36, lineHeight: 1.6 }}>
            Starten Sie in 5 Minuten. Kostenlos. Ohne Risiko.
          </p>
          <Button variant="brand" onClick={onSignup} style={{ padding: '16px 36px', fontSize: 17, fontWeight: 700 }}>
            Jetzt Workspace erstellen
            <i className="fa-solid fa-arrow-right" style={{ marginLeft: 10, fontSize: 15 }} />
          </Button>
          <p style={{ marginTop: 20, fontSize: 14, color: 'var(--muted)' }}>
            oder schreiben Sie uns für eine Demo:{' '}
            <a href="mailto:info@meetropolis.de" style={{ color: 'var(--brand-primary)', textDecoration: 'none' }}>
              info@meetropolis.de
            </a>
          </p>
          <p style={{ marginTop: 40, fontSize: 13, color: 'var(--muted)', opacity: 0.65, fontStyle: 'italic' }}>
            P.S. Starten Sie noch heute — bevor Ihre besten Leute das nächste &ldquo;Sind alle im Call?&rdquo;-Meeting satt haben.
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
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>Das virtuelle Büro für Remote Teams.</p>
            </div>
            <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Produkt</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <FLink onClick={() => scrollTo('funktionen')}>Funktionen</FLink>
                  <FLink onClick={onPricing}>Preise</FLink>
                  <FLink href="https://github.com/lass-machen/meetropolis">GitHub</FLink>
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Rechtliches</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <FLink href="#/privacy">Datenschutz</FLink>
                  <FLink href="#/terms">AGB</FLink>
                  <FLink href="#/impressum">Impressum</FLink>
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Kontakt</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <FLink href="mailto:support@meetropolis.de">Support</FLink>
                  <FLink href="mailto:sales@meetropolis.de">Vertrieb</FLink>
                </div>
              </div>
            </div>
          </div>
          <div style={{ paddingTop: 24, borderTop: '1px solid var(--border)', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Open Source unter Apache-2.0 | Copyright 2025 Meetropolis Contributors
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
