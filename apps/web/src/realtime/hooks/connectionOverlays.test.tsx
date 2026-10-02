import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getEnterpriseWebModule = vi.hoisted(() => vi.fn());

vi.mock('../../lib/enterpriseWebLoader', () => ({ getEnterpriseWebModule }));
vi.mock('../../app/providers/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('react-dom/server', () => ({ renderToStaticMarkup: () => '<svg></svg>' }));
vi.mock('lucide-react', () => ({ Timer: 'Timer', Plug: 'Plug', TriangleAlert: 'TriangleAlert' }));

import { showTranscriptionConsentOverlay } from './connectionOverlays';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
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
