import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getEnterpriseWebModule = vi.hoisted(() => vi.fn());

vi.mock('../../lib/enterpriseWebLoader', () => ({ getEnterpriseWebModule }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { HudPanel } from './HudPanel';
import { setAuthTenantSlug } from '../../lib/colyseus';

afterEach(() => {
  cleanup();
  setAuthTenantSlug(null);
});

describe('HudPanel transcription indicator slot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuthTenantSlug('workspace');
  });

  it('renders the optional indicator with the current tenant slug', async () => {
    const Indicator = ({ tenantSlug }: { tenantSlug: string }) => <div>{`indicator:${tenantSlug}`}</div>;
    getEnterpriseWebModule.mockResolvedValue({ TranscriptionIndicator: Indicator });

    render(<HudPanel hud={{}} />);

    expect(await screen.findByText('indicator:workspace')).toBeTruthy();
  });
});
