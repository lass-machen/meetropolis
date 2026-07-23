// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RegisterStep3View } from './RegisterStep3View';
import { usePublicConfigStore } from '../../../state/publicConfigStore';
import type { TenantSignupSubmission } from './signupTypes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => (opts ? `${k}:${JSON.stringify(opts)}` : k),
    i18n: { language: 'de' },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

const PLANS = [
  {
    tierKey: 'startup',
    name: { de: 'Startup', en: 'Startup' },
    priceAmount: 1999,
    priceCurrency: 'EUR',
    priceInterval: 'month',
    concurrentLimit: 5,
    minConnections: 2,
    features: [{ de: 'Bis zu 5 Teilnehmer', en: 'Up to 5' }],
    highlighted: false,
    customPricing: false,
    sortOrder: 0,
  },
  {
    tierKey: 'team',
    name: { de: 'Team', en: 'Team' },
    priceAmount: 4999,
    priceCurrency: 'EUR',
    priceInterval: 'month',
    concurrentLimit: 15,
    minConnections: 6,
    features: [{ de: 'Bis zu 15 Teilnehmer', en: 'Up to 15' }],
    highlighted: true,
    customPricing: false,
    sortOrder: 1,
  },
];

function stubPlansFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ plans: PLANS }) } as unknown as Response)),
  );
}

// Full seed shape incl. Business (35) and a custom Enterprise, for the
// large-team recommendation path.
const FULL_PLANS = [
  ...PLANS,
  {
    tierKey: 'business',
    name: { de: 'Business', en: 'Business' },
    priceAmount: 9999,
    priceCurrency: 'EUR',
    priceInterval: 'month',
    concurrentLimit: 35,
    minConnections: 16,
    features: [{ de: 'Bis zu 35 Teilnehmer', en: 'Up to 35' }],
    highlighted: false,
    customPricing: false,
    sortOrder: 2,
  },
  {
    tierKey: 'enterprise',
    name: { de: 'Enterprise', en: 'Enterprise' },
    priceAmount: null,
    priceCurrency: 'EUR',
    priceInterval: null,
    concurrentLimit: null,
    minConnections: null,
    features: [{ de: 'Individuell', en: 'Custom' }],
    highlighted: false,
    customPricing: true,
    sortOrder: 3,
  },
];

function stubFullPlansFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ plans: FULL_PLANS }) } as unknown as Response),
    ),
  );
}

describe('RegisterStep3View — billing gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    usePublicConfigStore.setState({ billingEnabled: false, loaded: false });
  });

  it('OSS mode (billingEnabled=false): shows neither plans nor B2B, just creates the workspace', () => {
    usePublicConfigStore.setState({ billingEnabled: false, loaded: true });
    const onSubmit = vi.fn((_s: TenantSignupSubmission) => Promise.resolve());
    render(<RegisterStep3View apiBase="http://api.test" onContinue={vi.fn()} onSubmit={onSubmit} onBack={() => {}} />);

    expect(screen.queryByText('auth.b2bSectionTitle')).toBeNull();
    expect(screen.queryByText('auth.selectPlanTitle')).toBeNull();
    fireEvent.click(screen.getByText('auth.createWorkspace'));
    expect(onSubmit).toHaveBeenCalledWith({ tierKey: null, b2b: null });
  });

  it('commercial mode is plan selection only: net price, trial and continue — no B2B/order here', async () => {
    usePublicConfigStore.setState({ billingEnabled: true, loaded: true });
    stubPlansFetch();
    render(<RegisterStep3View apiBase="http://api.test" onContinue={vi.fn()} onSubmit={vi.fn()} onBack={() => {}} />);

    expect(await screen.findByText('49,99 €')).toBeInTheDocument(); // team net
    expect(screen.getByText('19,99 €')).toBeInTheDocument(); // startup net
    // Trial is made explicit on every payable card.
    expect(screen.getAllByText('auth.trialBadge').length).toBe(2);
    // The order/company form has moved to step 4 — not present here.
    expect(screen.queryByText('auth.b2bSectionTitle')).toBeNull();
    expect(screen.queryByText('auth.orderCta')).toBeNull();
    expect(screen.getByText('auth.planContinue')).toBeInTheDocument();
  });

  it('recommends the team-size plan and continues with it', async () => {
    usePublicConfigStore.setState({ billingEnabled: true, loaded: true });
    stubPlansFetch();
    const onContinue = vi.fn();
    // teamSize "15" is the Team bucket → Team is recommended and preselected.
    render(
      <RegisterStep3View
        apiBase="http://api.test"
        teamSize="15"
        onContinue={onContinue}
        onSubmit={vi.fn()}
        onBack={() => {}}
      />,
    );
    await screen.findByText('49,99 €');

    // Exactly one "recommended" badge, on the team-size match.
    expect(screen.getAllByText('auth.recommended').length).toBe(1);

    fireEvent.click(screen.getByText('auth.planContinue'));
    expect(onContinue).toHaveBeenCalledWith('team');
  });

  it('recommends the smallest plan for a small team', async () => {
    usePublicConfigStore.setState({ billingEnabled: true, loaded: true });
    stubPlansFetch();
    const onContinue = vi.fn();
    render(
      <RegisterStep3View
        apiBase="http://api.test"
        teamSize="5"
        onContinue={onContinue}
        onSubmit={vi.fn()}
        onBack={() => {}}
      />,
    );
    await screen.findByText('49,99 €');

    fireEvent.click(screen.getByText('auth.planContinue'));
    expect(onContinue).toHaveBeenCalledWith('startup');
  });

  it('honours a real landing deep-link over the team-size recommendation', async () => {
    usePublicConfigStore.setState({ billingEnabled: true, loaded: true });
    stubPlansFetch();
    const onContinue = vi.fn();
    // Team-size bucket "15" would recommend Team, but a deliberate deep-link to
    // Startup must win the preselection. Regression guard for the plan-default
    // channel: the wizard default must NOT masquerade as a deep-link.
    render(
      <RegisterStep3View
        apiBase="http://api.test"
        teamSize="15"
        initialPlan="startup"
        onContinue={onContinue}
        onSubmit={vi.fn()}
        onBack={() => {}}
      />,
    );
    await screen.findByText('49,99 €');

    fireEvent.click(screen.getByText('auth.planContinue'));
    expect(onContinue).toHaveBeenCalledWith('startup');
  });

  it('recommends enterprise for a large team but preselects the largest payable plan', async () => {
    usePublicConfigStore.setState({ billingEnabled: true, loaded: true });
    stubFullPlansFetch();
    const onContinue = vi.fn();
    render(
      <RegisterStep3View
        apiBase="http://api.test"
        teamSize="custom"
        onContinue={onContinue}
        onSubmit={vi.fn()}
        onBack={() => {}}
      />,
    );
    await screen.findByText('99,99 €'); // business net

    // Exactly one "recommended" badge, on Enterprise (the custom bucket).
    expect(screen.getAllByText('auth.recommended').length).toBe(1);
    // Enterprise cannot be checked out → continue with the largest payable plan.
    fireEvent.click(screen.getByText('auth.planContinue'));
    expect(onContinue).toHaveBeenCalledWith('business');
  });
});
