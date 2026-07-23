import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockState = vi.hoisted(() => ({ mapId: 'map-1' }));

vi.mock('../lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../lib/runtimeConfig', () => ({
  getApiBaseFromWindow: () => 'http://api.test',
}));

vi.mock('../state/mapStore', () => ({
  useMapStore: { getState: () => ({ currentMapId: mockState.mapId }) },
}));

import {
  enqueueTilesetRegistration,
  resetTilesetRegistrationQueueForTests,
  type TilesetRegistrationRequest,
} from './tilesetRegistrationQueue';
import { logger } from '../lib/logger';

const okResponse = { ok: true, json: () => Promise.resolve({}) };
const failResponse = { ok: false, status: 500 };

function makeRequest(key: string): TilesetRegistrationRequest {
  return { key, dataUrl: `data:image/png;base64,${key}`, tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 };
}

describe('tilesetRegistrationQueue', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    mockState.mapId = 'map-1';
    resetTilesetRegistrationQueueForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetTilesetRegistrationQueueForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('registers each tileset exactly once per map, even across repeated registration runs', async () => {
    fetchMock.mockResolvedValue(okResponse);
    enqueueTilesetRegistration(makeRequest('a'));
    enqueueTilesetRegistration(makeRequest('b'));
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    enqueueTilesetRegistration(makeRequest('a'));
    enqueueTilesetRegistration(makeRequest('b'));
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('deduplicates enqueues for a key that is still pending', async () => {
    fetchMock.mockResolvedValue(okResponse);
    enqueueTilesetRegistration(makeRequest('a'));
    enqueueTilesetRegistration(makeRequest('a'));
    enqueueTilesetRegistration(makeRequest('a'));
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a failed registration with exponential backoff', async () => {
    fetchMock.mockResolvedValueOnce(failResponse).mockResolvedValue(okResponse);
    enqueueTilesetRegistration(makeRequest('a'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    enqueueTilesetRegistration(makeRequest('a'));
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('pauses the remaining queue during a backoff window instead of bursting', async () => {
    fetchMock.mockResolvedValueOnce(failResponse).mockResolvedValue(okResponse);
    enqueueTilesetRegistration(makeRequest('a'));
    enqueueTilesetRegistration(makeRequest('b'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after the per-tileset retry budget and stops issuing requests', async () => {
    fetchMock.mockResolvedValue(failResponse);
    enqueueTilesetRegistration(makeRequest('a'));
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Giving up on tileset "a"'));

    enqueueTilesetRegistration(makeRequest('a'));
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('waits for the map id to resolve before posting registrations', async () => {
    mockState.mapId = '';
    fetchMock.mockResolvedValue(okResponse);
    enqueueTilesetRegistration(makeRequest('a'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();

    mockState.mapId = 'map-2';
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/maps/map-2/tilesets');
  });

  it('does not inflate the missing-map backoff when many enqueues race one timer', async () => {
    mockState.mapId = '';
    fetchMock.mockResolvedValue(okResponse);
    // 50 boot enqueues while the map id is unresolved: only one timer is
    // armed, so the second attempt must still fire after the base delay
    // window, not after the 30s cap.
    for (let i = 0; i < 50; i++) enqueueTilesetRegistration(makeRequest(`t${i}`));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();

    mockState.mapId = 'map-2';
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(50);
  });

  it('drops stale queued entries when the map changes before they are posted', async () => {
    fetchMock.mockResolvedValueOnce(failResponse).mockResolvedValue(okResponse);
    enqueueTilesetRegistration(makeRequest('a'));
    enqueueTilesetRegistration(makeRequest('b'));
    await vi.advanceTimersByTimeAsync(0);
    // 'a' failed and is waiting for its retry; 'b' is still queued.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    mockState.mapId = 'map-2';
    enqueueTilesetRegistration(makeRequest('c'));
    await vi.runAllTimersAsync();

    // The stale map-1 payloads must not be posted against map-2; only the
    // fresh entry for map-2 goes out.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('/maps/map-2/'))).toHaveLength(1);
    const bodies = fetchMock.mock.calls
      .filter((c) => String(c[0]).includes('/maps/map-2/'))
      .map((c) => JSON.parse((c[1] as RequestInit).body as string).key);
    expect(bodies).toEqual(['c']);
  });
});
