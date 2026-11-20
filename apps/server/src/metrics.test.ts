import { describe, expect, it, vi } from 'vitest';

describe('metrics', () => {
  it('reuses the request duration metric across fresh module evaluations', async () => {
    const first = await import('./metrics.js');
    vi.resetModules();
    const second = await import('./metrics.js');
    expect(second.httpRequestDuration).toBe(first.httpRequestDuration);
  });

  it('loads the rejection metrics twice without duplicate registration', async () => {
    await import('./rooms/validation/rejectionMetrics.js');
    vi.resetModules();
    await import('./rooms/validation/rejectionMetrics.js');
  });
});
