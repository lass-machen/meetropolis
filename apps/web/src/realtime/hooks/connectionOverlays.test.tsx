import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getEnterpriseWebModule = vi.hoisted(() => vi.fn());

vi.mock('../../lib/enterpriseWebLoader', () => ({ getEnterpriseWebModule }));
vi.mock('../../app/providers/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('react-dom/server', () => ({ renderToStaticMarkup: () => '<svg></svg>' }));
vi.mock('lucide-react', () => ({ Timer: 'Timer', Plug: 'Plug', TriangleAlert: 'TriangleAlert' }));

import {
  showAuthExpiredOverlay,
  showClientTooOldOverlay,
  showGuestExpiredOverlay,
  showLimitErrorOverlay,
  showSessionTakenOverOverlay,
  showTranscriptionConsentOverlay,
} from './connectionOverlays';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function expectResponsiveMinWidth(): void {
  const markup = document.body.innerHTML;
  // 82px = 16px side margins plus 24px padding and 1px border on each side.
  expect(markup).toContain('min(320px, calc(100vw - 82px))');
  expect(markup).not.toContain('min-width:320px');
}

describe('connection overlay min-width', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses a viewport-capped min-width on the guest expired overlay', () => {
    showGuestExpiredOverlay('http://localhost');
    expectResponsiveMinWidth();
  });

  it('uses a viewport-capped min-width on the auth expired overlay', () => {
    showAuthExpiredOverlay('http://localhost');
    expectResponsiveMinWidth();
  });

  it('uses a viewport-capped min-width on the client too old overlay', () => {
    showClientTooOldOverlay();
    expectResponsiveMinWidth();
  });

  it('uses a viewport-capped min-width on the session taken over overlay', () => {
    showSessionTakenOverOverlay();
    expectResponsiveMinWidth();
  });

  it('uses a viewport-capped min-width on the limit error overlay', () => {
    showLimitErrorOverlay(429, 'limit', vi.fn());
    expectResponsiveMinWidth();
  });

  it('uses a viewport-capped min-width on the transcription consent fallback', async () => {
    getEnterpriseWebModule.mockResolvedValue(null);
    showTranscriptionConsentOverlay({
      tenantSlug: 'workspace',
      onAccepted: vi.fn(),
      onDeclined: vi.fn(),
    });
    await waitFor(() => expect(document.body.innerHTML).toContain('min(320px'));
    expectResponsiveMinWidth();
  });
});

describe('showTranscriptionConsentOverlay', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the optional gate with its tenant and callbacks', async () => {
    const onAccepted = vi.fn();
    const onDeclined = vi.fn();
    const Gate = ({
      tenantSlug,
      onAccepted: accept,
      onDeclined: decline,
    }: {
      tenantSlug: string;
      onAccepted: () => void;
      onDeclined: () => void;
    }) => (
      <div>
        <span>{tenantSlug}</span>
        <button onClick={accept}>Accept</button>
        <button onClick={decline}>Decline</button>
      </div>
    );
    getEnterpriseWebModule.mockResolvedValue({ TranscriptionConsentGate: Gate });

    showTranscriptionConsentOverlay({ tenantSlug: 'workspace', onAccepted, onDeclined });

    expect(await screen.findByText('workspace')).toBeTruthy();
    fireEvent.click(screen.getByText('Accept'));
    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(onDeclined).not.toHaveBeenCalled();
  });

  it('renders the neutral fallback when the optional gate is absent', async () => {
    getEnterpriseWebModule.mockResolvedValue(null);

    showTranscriptionConsentOverlay({ tenantSlug: 'workspace', onAccepted: vi.fn(), onDeclined: vi.fn() });

    await waitFor(() => expect(screen.getByText('connection.transcriptionConsentRequired')).toBeTruthy());
  });
});
