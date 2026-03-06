import React from 'react';
import { Button, Card } from '../system';
import { ThemeToggleButton } from '../theme';

interface PricingPageProps {
  onBack: () => void;
  onSignup: (plan?: string) => void;
  onLogin: () => void;
  registrationEnabled?: boolean;
}

interface Plan {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  highlighted?: boolean;
  cta: string;
  plan?: string;
}

const plans: Plan[] = [
  {
    name: 'Free',
    price: '0',
    period: 'forever',
    description: 'Perfect for trying out Meetropolis',
    features: [
      'Up to 3 concurrent users',
      'Basic audio/video',
      'Default map',
      'Community support',
    ],
    cta: 'Get Started',
    plan: 'free',
  },
  {
    name: 'Starter',
    price: '29',
    period: '/month',
    description: 'For small teams getting started',
    features: [
      'Up to 10 concurrent users',
      'HD audio/video',
      'Custom maps',
      'Screen sharing',
      'Email support',
    ],
    highlighted: true,
    cta: 'Start Free Trial',
    plan: 'starter',
  },
  {
    name: 'Team',
    price: '79',
    period: '/month',
    description: 'For growing teams',
    features: [
      'Up to 50 concurrent users',
      'HD audio/video',
      'Unlimited custom maps',
      'Private zones',
      'Admin controls',
      'Priority support',
    ],
    cta: 'Start Free Trial',
    plan: 'team',
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For large organizations',
    features: [
      'Unlimited users',
      '4K video support',
      'SSO / SAML',
      'Custom branding',
      'SLA guarantee',
      'Dedicated support',
      'On-premise option',
    ],
    cta: 'Contact Sales',
    plan: 'enterprise',
  },
];

export function PricingPage({ onBack, onSignup, onLogin, registrationEnabled = true }: PricingPageProps) {
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
        <div
          onClick={onBack}
          style={{
            fontSize: 24,
            fontWeight: 800,
            background: 'var(--gradient-hero)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            cursor: 'pointer',
          }}
        >
          Meetropolis
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <ThemeToggleButton />
          <Button variant="ghost" onClick={onLogin}>Login</Button>
          {registrationEnabled && (
            <Button variant="brand" onClick={() => onSignup()}>Get Started</Button>
          )}
        </div>
      </header>

      {/* Pricing Header */}
      <section style={{
        padding: '60px 24px 40px',
        textAlign: 'center',
        maxWidth: 800,
        margin: '0 auto',
      }}>
        <h1 style={{
          fontSize: 'clamp(32px, 5vw, 48px)',
          fontWeight: 900,
          marginBottom: 16,
        }}>
          Simple, Transparent Pricing
        </h1>
        <p style={{
          fontSize: 18,
          color: 'var(--muted)',
          maxWidth: 500,
          margin: '0 auto',
        }}>
          Start free with 3 seats. Upgrade as your team grows.
          No hidden fees, cancel anytime.
        </p>
      </section>

      {/* Pricing Cards */}
      <section style={{
        padding: '0 24px 80px',
        maxWidth: 1200,
        margin: '0 auto',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 24,
          alignItems: 'stretch',
        }}>
          {plans.map((plan) => (
            <PricingCard
              key={plan.name}
              plan={plan}
              ctaOverride={
                plan.plan === 'enterprise' || registrationEnabled
                  ? undefined
                  : 'Login'
              }
              onSelect={() => {
                if (plan.plan === 'enterprise') {
                  window.location.href = 'mailto:sales@meetropolis.de?subject=Enterprise%20Inquiry';
                } else if (registrationEnabled) {
                  onSignup(plan.plan);
                } else {
                  onLogin();
                }
              }}
            />
          ))}
        </div>
      </section>

      {/* FAQ Section */}
      <section style={{
        padding: '60px 24px',
        background: 'var(--glass)',
      }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', marginBottom: 40, fontSize: 32 }}>
            Frequently Asked Questions
          </h2>
          <div style={{ display: 'grid', gap: 24 }}>
            <FaqItem
              question="What counts as a concurrent user?"
              answer="A concurrent user is someone actively connected to your Meetropolis space. If you have 10 people on your team but only 5 are online at once, you only need capacity for 5."
            />
            <FaqItem
              question="Can I upgrade or downgrade anytime?"
              answer="Yes! You can change your plan at any time. When upgrading, you'll be charged the prorated difference. When downgrading, the new rate applies at your next billing cycle."
            />
            <FaqItem
              question="Is there a free trial?"
              answer="All paid plans come with a 14-day free trial. No credit card required to start. The Free plan is free forever with up to 3 concurrent users."
            />
            <FaqItem
              question="Do you offer discounts for nonprofits or education?"
              answer="Yes! We offer 50% off for verified nonprofits and educational institutions. Contact us at support@meetropolis.de to apply."
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        padding: '40px 24px',
        textAlign: 'center',
        color: 'var(--muted)',
        fontSize: 14,
      }}>
        Open Source under Apache-2.0 | Copyright 2025 Meetropolis Contributors
      </footer>
    </div>
  );
}

function PricingCard({ plan, onSelect, ctaOverride }: { plan: Plan; onSelect: () => void; ctaOverride?: string | undefined }) {
  return (
    <Card style={{
      padding: 24,
      display: 'flex',
      flexDirection: 'column',
      border: plan.highlighted ? '2px solid var(--brand-primary)' : undefined,
      position: 'relative',
    }}>
      {plan.highlighted && (
        <div style={{
          position: 'absolute',
          top: -12,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--brand-primary)',
          color: 'white',
          padding: '4px 12px',
          borderRadius: 12,
          fontSize: 12,
          fontWeight: 600,
        }}>
          Most Popular
        </div>
      )}
      <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>{plan.name}</h3>
      <div style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 36, fontWeight: 800 }}>
          {plan.price === 'Custom' ? '' : '\u20AC'}{plan.price}
        </span>
        <span style={{ color: 'var(--muted)', fontSize: 14 }}>{plan.period}</span>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>
        {plan.description}
      </p>
      <ul style={{
        listStyle: 'none',
        padding: 0,
        margin: '0 0 24px',
        flex: 1,
      }}>
        {plan.features.map((feature, i) => (
          <li key={i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10,
            fontSize: 14,
          }}>
            <i className="fa-solid fa-check" style={{ color: 'var(--success)', fontSize: 12 }} />
            {feature}
          </li>
        ))}
      </ul>
      <Button
        variant={plan.highlighted ? 'brand' : 'secondary'}
        onClick={onSelect}
        style={{ width: '100%' }}
      >
        {ctaOverride || plan.cta}
      </Button>
    </Card>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div
      style={{
        borderBottom: '1px solid var(--border)',
        paddingBottom: 16,
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
          fontWeight: 600,
          fontSize: 16,
        }}
      >
        {question}
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'}`} style={{ fontSize: 12 }} />
      </button>
      {open && (
        <p style={{ margin: '12px 0 0', color: 'var(--muted)', lineHeight: 1.6 }}>
          {answer}
        </p>
      )}
    </div>
  );
}
