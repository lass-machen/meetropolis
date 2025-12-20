import { Button, Card } from '../system';
import { ThemeToggleButton } from '../theme';

interface LandingPageProps {
  onLogin: () => void;
  onSignup: () => void;
  onPricing: () => void;
}

export function LandingPage({ onLogin, onSignup, onPricing }: LandingPageProps) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      color: 'var(--fg)',
    }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 24px',
        maxWidth: 1200,
        margin: '0 auto',
      }}>
        <div style={{
          fontSize: 24,
          fontWeight: 800,
          background: 'var(--gradient-hero)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          Meetropolis
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <ThemeToggleButton />
          <Button variant="ghost" onClick={onPricing}>Pricing</Button>
          <Button variant="ghost" onClick={onLogin}>Login</Button>
          <Button variant="brand" onClick={onSignup}>Get Started</Button>
        </div>
      </header>

      {/* Hero Section */}
      <section style={{
        padding: '80px 24px',
        textAlign: 'center',
        maxWidth: 900,
        margin: '0 auto',
      }}>
        <h1 style={{
          fontSize: 'clamp(36px, 6vw, 64px)',
          fontWeight: 900,
          lineHeight: 1.1,
          marginBottom: 24,
          background: 'var(--gradient-hero)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          Your Virtual Office for Remote Teams
        </h1>
        <p style={{
          fontSize: 'clamp(16px, 2vw, 20px)',
          color: 'var(--muted)',
          maxWidth: 600,
          margin: '0 auto 40px',
          lineHeight: 1.6,
        }}>
          Bring your team together in a spatial environment. Walk up to colleagues,
          have spontaneous conversations, and feel the presence of your team.
        </p>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button variant="brand" onClick={onSignup} style={{ padding: '14px 32px', fontSize: 16 }}>
            Start Free Trial
          </Button>
          <Button variant="secondary" onClick={onPricing} style={{ padding: '14px 32px', fontSize: 16 }}>
            View Pricing
          </Button>
        </div>
      </section>

      {/* Features Grid */}
      <section style={{
        padding: '60px 24px',
        maxWidth: 1200,
        margin: '0 auto',
      }}>
        <h2 style={{ textAlign: 'center', marginBottom: 48, fontSize: 32, fontWeight: 700 }}>
          Why Teams Love Meetropolis
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 24,
        }}>
          <FeatureCard
            icon="users"
            title="Spatial Audio"
            description="Hear conversations naturally based on proximity. Walk closer to join, walk away to leave."
          />
          <FeatureCard
            icon="video"
            title="Video & Screen Share"
            description="Crystal-clear video calls and screen sharing powered by LiveKit."
          />
          <FeatureCard
            icon="map"
            title="Custom Maps"
            description="Design your own office layout with our built-in map editor."
          />
          <FeatureCard
            icon="shield"
            title="Private Zones"
            description="Create meeting rooms and private areas for focused discussions."
          />
          <FeatureCard
            icon="zap"
            title="Low Latency"
            description="Real-time presence and communication with minimal delay."
          />
          <FeatureCard
            icon="desktop"
            title="Desktop App"
            description="Native app for Windows and macOS for the best experience."
          />
        </div>
      </section>

      {/* CTA Section */}
      <section style={{
        padding: '80px 24px',
        textAlign: 'center',
        background: 'var(--glass)',
        marginTop: 60,
      }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, marginBottom: 16 }}>
          Ready to Transform Your Remote Work?
        </h2>
        <p style={{ color: 'var(--muted)', marginBottom: 32, fontSize: 18 }}>
          Start with 3 free seats. No credit card required.
        </p>
        <Button variant="brand" onClick={onSignup} style={{ padding: '16px 40px', fontSize: 18 }}>
          Create Your Space
        </Button>
      </section>

      {/* Footer */}
      <footer style={{
        padding: '40px 24px',
        textAlign: 'center',
        color: 'var(--muted)',
        fontSize: 14,
      }}>
        <div style={{ marginBottom: 16 }}>
          <a href="https://github.com/lass-machen/meetropolis" target="_blank" rel="noopener" style={{ color: 'var(--muted)', marginRight: 24 }}>
            GitHub
          </a>
          <a href="/docs" style={{ color: 'var(--muted)', marginRight: 24 }}>
            Documentation
          </a>
          <a href="mailto:support@meetropolis.de" style={{ color: 'var(--muted)' }}>
            Contact
          </a>
        </div>
        <div style={{ marginBottom: 16 }}>
          <a href="#/privacy" style={{ color: 'var(--muted)', marginRight: 24 }}>
            Privacy Policy
          </a>
          <a href="#/terms" style={{ color: 'var(--muted)', marginRight: 24 }}>
            Terms of Service
          </a>
          <a href="#/impressum" style={{ color: 'var(--muted)' }}>
            Impressum
          </a>
        </div>
        <div>
          Open Source under Apache-2.0 | Copyright 2025 Meetropolis Contributors
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  const iconMap: Record<string, string> = {
    users: 'fa-users',
    video: 'fa-video',
    map: 'fa-map',
    shield: 'fa-shield-halved',
    zap: 'fa-bolt',
    desktop: 'fa-desktop',
  };

  return (
    <Card style={{ padding: 24, textAlign: 'left' }}>
      <div style={{
        width: 48,
        height: 48,
        borderRadius: 12,
        background: 'var(--brand-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
        color: 'white',
        fontSize: 20,
      }}>
        <i className={`fa-solid ${iconMap[icon] || 'fa-star'}`} />
      </div>
      <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 600 }}>{title}</h3>
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, lineHeight: 1.5 }}>{description}</p>
    </Card>
  );
}
