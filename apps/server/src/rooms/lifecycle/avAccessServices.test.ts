import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const calls: string[] = [];
  const reconcilerStop = vi.fn(async () => {
    calls.push('reconciler.stop');
  });
  return {
    calls,
    reconcilerStop,
    startAvAccessReconciler: vi.fn(() => ({ runRound: vi.fn(), stop: reconcilerStop })),
    stopAvPendingRevocations: vi.fn(async () => {
      calls.push('backlog.stop');
    }),
  };
});

vi.mock('./avAccessReconciler.js', () => ({ startAvAccessReconciler: mocks.startAvAccessReconciler }));
vi.mock('./avPendingRevocations.js', () => ({ stopAvPendingRevocations: mocks.stopAvPendingRevocations }));

import { startAvAccessServices } from './avAccessServices.js';

type Prisma = Parameters<typeof startAvAccessServices>[0];

describe('startAvAccessServices', () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    vi.clearAllMocks();
  });

  it('starts the reconciler with the given prisma client', () => {
    const prisma = {} as Prisma;
    startAvAccessServices(prisma);
    expect(mocks.startAvAccessReconciler).toHaveBeenCalledTimes(1);
    expect(mocks.startAvAccessReconciler).toHaveBeenCalledWith(prisma);
  });

  it('stops the reconciler before the revocation backlog', async () => {
    const services = startAvAccessServices({} as Prisma);
    await services.stop();
    expect(mocks.calls).toEqual(['reconciler.stop', 'backlog.stop']);
  });

  it('stops only once when shutdown is requested twice', async () => {
    const services = startAvAccessServices({} as Prisma);
    await Promise.all([services.stop(), services.stop()]);
    expect(mocks.reconcilerStop).toHaveBeenCalledTimes(1);
    expect(mocks.stopAvPendingRevocations).toHaveBeenCalledTimes(1);
  });

  it('still stops the backlog when the reconciler stop fails', async () => {
    mocks.reconcilerStop.mockRejectedValueOnce(new Error('round failed'));
    const services = startAvAccessServices({} as Prisma);
    await expect(services.stop()).rejects.toThrow('round failed');
    expect(mocks.stopAvPendingRevocations).toHaveBeenCalledTimes(1);
  });
});
