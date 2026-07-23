// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RegisterStep4View } from './RegisterStep4View';
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

describe('RegisterStep4View — summary + company details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPlansFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the order overview (transparency) and the B2B form for the chosen tier', async () => {
    render(<RegisterStep4View apiBase="http://api.test" selectedTier="team" onSubmit={vi.fn()} onBack={() => {}} />);

    expect(await screen.findByText('auth.transparencyTitle')).toBeInTheDocument();
    expect(screen.getByText('auth.b2bSectionTitle')).toBeInTheDocument();
    expect(screen.getByText('auth.orderCta')).toBeInTheDocument();
  });

  it('blocks the order until the B2B fields are valid, then submits tierKey + b2b', async () => {
    const onSubmit = vi.fn((_s: TenantSignupSubmission) => Promise.resolve());
    render(<RegisterStep4View apiBase="http://api.test" selectedTier="team" onSubmit={onSubmit} onBack={() => {}} />);
    await screen.findByText('auth.transparencyTitle');

    fireEvent.click(screen.getByText('auth.orderCta'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('auth.errCompanyLegalName')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('auth.companyLegalName'), { target: { value: 'Acme GmbH' } });
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'GmbH' } });
    fireEvent.change(selects[1], { target: { value: 'DE' } });
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    fireEvent.click(screen.getByText('auth.orderCta'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submission = onSubmit.mock.calls[0][0];
    expect(submission.tierKey).toBe('team');
    expect(submission.b2b).toMatchObject({
      companyLegalName: 'Acme GmbH',
      legalForm: 'GmbH',
      billingCountry: 'DE',
      b2bDeclaration: true,
      agbVersion: '2026-07-01',
    });
  });
});
