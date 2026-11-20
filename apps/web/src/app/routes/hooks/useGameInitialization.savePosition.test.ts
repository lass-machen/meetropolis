import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildSavePosition } from './useGameInitialization';

type SaveParams = Parameters<typeof buildSavePosition>[0];

function makeParams(position: { x?: number; y?: number }, last = { x: 0, y: 0, direction: 'down' }): SaveParams {
  return {
    apiBase: 'http://api.test',
    localPosRef: { current: { id: 'session-local', ...position } },
    lastSavedPositionRef: { current: { ...last } },
  } as unknown as SaveParams;
}

function sentBodies(fetchMock: ReturnType<typeof vi.fn>): Array<{ x: number; y: number }> {
  return fetchMock.mock.calls.map((call) => JSON.parse((call[1] as { body: string }).body) as { x: number; y: number });
}

describe('buildSavePosition', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not store a position before the client knows one, even on unload', async () => {
    const save = buildSavePosition(makeParams({}));

    await save({ immediate: true });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stores a known position on unload', async () => {
    const save = buildSavePosition(makeParams({ x: 400, y: 320 }));

    await save({ immediate: true });

    expect(sentBodies(fetchMock)).toEqual([expect.objectContaining({ x: 400, y: 320 })]);
  });

  it('keeps a zero coordinate instead of the last saved one', async () => {
    const save = buildSavePosition(makeParams({ x: 0, y: 48 }, { x: 96, y: 48, direction: 'down' }));

    await save({ immediate: true });

    expect(sentBodies(fetchMock)).toEqual([expect.objectContaining({ x: 0, y: 48 })]);
  });
});
