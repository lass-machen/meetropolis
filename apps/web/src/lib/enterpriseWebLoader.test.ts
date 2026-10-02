import { afterEach, describe, expect, it, vi } from 'vitest';

const TestComponent = () => null;

async function loadWithModule(moduleValue: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock('@meetropolis/enterprise-web', () => ({ default: moduleValue }));
  const { getEnterpriseWebModule } = await import('./enterpriseWebLoader');
  return getEnterpriseWebModule();
}

afterEach(() => {
  vi.doUnmock('@meetropolis/enterprise-web');
  vi.resetModules();
});

describe('optional transcription slots', () => {
  it('accepts the optional components when present', async () => {
    const module = await loadWithModule({
      AdminEnterpriseTabs: TestComponent,
      BillingDashboard: TestComponent,
      PackStore: TestComponent,
      TranscriptionConsentGate: TestComponent,
      TranscriptionIndicator: TestComponent,
    });

    expect(module?.TranscriptionConsentGate).toBe(TestComponent);
    expect(module?.TranscriptionIndicator).toBe(TestComponent);
  });

  it('accepts the module when the optional components are absent', async () => {
    const module = await loadWithModule({
      AdminEnterpriseTabs: TestComponent,
      BillingDashboard: TestComponent,
      PackStore: TestComponent,
    });

    expect(module).not.toBeNull();
    expect(module?.TranscriptionConsentGate).toBeUndefined();
    expect(module?.TranscriptionIndicator).toBeUndefined();
  });
});
