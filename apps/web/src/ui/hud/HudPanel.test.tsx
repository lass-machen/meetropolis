import { act, cleanup, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getEnterpriseWebModule = vi.hoisted(() => vi.fn());

vi.mock('../../lib/enterpriseWebLoader', () => ({ getEnterpriseWebModule }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { HudPanel } from './HudPanel';
import type { TranscriptionIndicatorProps } from '../../lib/enterpriseWebLoader';
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

describe('HudPanel visibility with the indicator slot', () => {
  let reportVisibility: (visible: boolean) => void = () => undefined;
  const Indicator: ComponentType<TranscriptionIndicatorProps> = ({ onVisibilityChange }) => {
    reportVisibility = (visible) => onVisibilityChange?.(visible);
    return <div>indicator</div>;
  };

  function panelOf(element: HTMLElement): HTMLElement {
    const panel = element.parentElement;
    if (!panel) throw new Error('Expected the indicator to render inside the panel');
    return panel;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setAuthTenantSlug('workspace');
    getEnterpriseWebModule.mockResolvedValue({ TranscriptionIndicator: Indicator });
  });

  it('renders nothing when there is no indicator slot and nothing to show', async () => {
    getEnterpriseWebModule.mockResolvedValue(null);

    const { container } = render(<HudPanel hud={{}} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.firstChild).toBeNull();
  });

  it('keeps the panel hidden but the indicator mounted while only the slot exists', async () => {
    render(<HudPanel hud={{}} />);

    const panel = panelOf(await screen.findByText('indicator'));
    expect(panel.style.display).toBe('none');

    act(() => reportVisibility(false));
    expect(panel.style.display).toBe('none');
  });

  it('shows the panel once the indicator reports visible and hides it again', async () => {
    render(<HudPanel hud={{}} />);
    const panel = panelOf(await screen.findByText('indicator'));

    act(() => reportVisibility(true));
    expect(panel.style.display).toBe('flex');

    act(() => reportVisibility(false));
    expect(panel.style.display).toBe('none');
  });

  it('shows the panel for zone info regardless of the indicator state', async () => {
    render(<HudPanel hud={{ zone: 'Lobby' }} />);

    const panel = panelOf(await screen.findByText('indicator'));
    expect(panel.style.display).toBe('flex');
  });
});
