import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/utils/broadcast.js', () => ({
  broadcastAccessRevoked: vi.fn(),
}));

vi.mock('../rooms/lifecycle/avPendingRevocations.js', () => ({
  enqueueAvRevocation: vi.fn(),
}));

vi.mock('../rooms/lifecycle/livekitRevocation.js', () => ({
  listWorldRoomNames: vi.fn(),
}));

import { broadcastAccessRevoked } from '../api/utils/broadcast.js';
import { enqueueAvRevocation } from '../rooms/lifecycle/avPendingRevocations.js';
import { listWorldRoomNames } from '../rooms/lifecycle/livekitRevocation.js';
import { revokeAccountAccess } from './tenantAccessRevocation.js';

const broadcastMock = vi.mocked(broadcastAccessRevoked);
const enqueueMock = vi.mocked(enqueueAvRevocation);
const listMock = vi.mocked(listWorldRoomNames);

async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([]);
});

describe('revokeAccountAccess', () => {
  it('enqueues a world room of a foreign tenant for the user', async () => {
    listMock.mockResolvedValue(['foreign:world', 'own:world']);

    await revokeAccountAccess('user-a', ['own']);
    await flushAsync();

    expect(broadcastMock).toHaveBeenCalledTimes(1);
    expect(broadcastMock).toHaveBeenCalledWith('user-a');
    expect(enqueueMock).toHaveBeenCalledWith('own:world', 'user-a');
    expect(enqueueMock).toHaveBeenCalledWith('foreign:world', 'user-a');
    expect(enqueueMock).toHaveBeenCalledTimes(2);
  });

  it('does not enqueue an own membership room twice', async () => {
    listMock.mockResolvedValue(['own:world']);

    await revokeAccountAccess('user-a', ['own']);
    await flushAsync();

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith('own:world', 'user-a');
  });

  it('still resolves and enqueues membership rooms when listing fails', async () => {
    listMock.mockRejectedValue(new Error('listing unavailable'));

    await expect(revokeAccountAccess('user-a', ['own'])).resolves.toBeUndefined();
    await flushAsync();

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith('own:world', 'user-a');
  });

  it('still resolves and enqueues membership rooms when listing is empty', async () => {
    listMock.mockResolvedValue([]);

    await expect(revokeAccountAccess('user-a', ['own'])).resolves.toBeUndefined();
    await flushAsync();

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith('own:world', 'user-a');
  });
});
