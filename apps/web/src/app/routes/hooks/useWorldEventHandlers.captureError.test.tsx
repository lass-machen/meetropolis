import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorldEventHandlers } from './useWorldEventHandlers';

type Params = Parameters<typeof useWorldEventHandlers>[0];

type AvMock = {
  setMicrophoneEnabled: ReturnType<typeof vi.fn>;
  setCameraEnabled: ReturnType<typeof vi.fn>;
  startScreenshare: ReturnType<typeof vi.fn>;
  stopScreenshare: ReturnType<typeof vi.fn>;
};

function makeAvState(over: Record<string, boolean> = {}) {
  return { mic: false, cam: false, share: false, dnd: false, ...over };
}

function makeParams(avState: Record<string, boolean>, av: Partial<AvMock> = {}) {
  const state = { ...avState };
  const setAvState = vi.fn((updater: (s: Record<string, boolean>) => Record<string, boolean>) => {
    Object.assign(state, updater(state));
  });
  const avRef = {
    current: {
      setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
      setCameraEnabled: vi.fn().mockResolvedValue(undefined),
      startScreenshare: vi.fn().mockResolvedValue(true),
      stopScreenshare: vi.fn().mockResolvedValue(undefined),
      ...av,
    },
  };
  const params = {
    apiBase: '',
    avRef,
    avState: state,
    editor: {},
    contextMenu: {},
    gameBridge: {},
    setAvState,
    setSelectedMicId: vi.fn(),
    setSelectedCamId: vi.fn(),
    setGridExpanded: vi.fn(),
    setSelectedSid: vi.fn(),
    setMenuOpen: vi.fn(),
    setTenantTab: vi.fn(),
    setPage: vi.fn(),
    setAdminOpen: vi.fn(),
    setApiModalOpen: vi.fn(),
    setBillingOpen: vi.fn(),
    setProfileOpen: vi.fn(),
    setTenantSettingsOpen: vi.fn(),
    setSessionsOpen: vi.fn(),
    setRosterCollapsed: vi.fn(),
    setBubbleUi: vi.fn(),
    setContextMenu: vi.fn(),
    setMe: vi.fn(),
    applyVolumesToUi: vi.fn(),
    saveAllToServer: vi.fn(),
    handleConnectionReload: vi.fn(),
    dismissBanner: vi.fn(),
  } as unknown as Params;
  return { params, state, setAvState, avRef };
}

describe('useWorldEventHandlers captureError (Q-AV-2)', () => {
  it('meldet eine abgelehnte Mikrofon-Aktivierung per Hinweis-Key und rollt den UI-Schalter zurück', async () => {
    const { params, state } = makeParams(makeAvState(), {
      setMicrophoneEnabled: vi.fn().mockRejectedValue(new Error('Permission denied')),
    });
    const { result } = renderHook((p: Params) => useWorldEventHandlers(p), { initialProps: params });

    await act(async () => {
      await result.current.handleToggleMic();
    });

    expect(state.mic).toBe(false);
    expect(result.current.captureError).toBe('av.microphoneCaptureFailed');
  });

  it('bezeichnet einen fehlgeschlagenen bewussten Ausschaltvorgang des Mikrofons nicht als Aufnahmefehler', async () => {
    const { params } = makeParams(makeAvState({ mic: true }), {
      setMicrophoneEnabled: vi.fn().mockRejectedValue(new Error('closed')),
    });
    const { result } = renderHook((p: Params) => useWorldEventHandlers(p), { initialProps: params });

    await act(async () => {
      await result.current.handleToggleMic();
    });

    expect(result.current.captureError).toBeNull();
  });

  it('räumt den Hinweis bei erfolgreichem neuem Versuch und bei Dismiss auf', async () => {
    const failing = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined);
    const { params } = makeParams(makeAvState(), { setMicrophoneEnabled: failing });
    const { result } = renderHook((p: Params) => useWorldEventHandlers(p), {
      initialProps: params,
    });

    await act(async () => {
      await result.current.handleToggleMic();
    });
    expect(result.current.captureError).toBe('av.microphoneCaptureFailed');

    act(() => {
      result.current.dismissCaptureError();
    });
    expect(result.current.captureError).toBeNull();
  });

  it('meldet eine abgelehnte Kamera-Aktivierung per Hinweis-Key und rollt den UI-Schalter zurück', async () => {
    const { params, state } = makeParams(makeAvState(), {
      setCameraEnabled: vi.fn().mockRejectedValue(new Error('NotFoundError: device missing')),
    });
    const { result } = renderHook((p: Params) => useWorldEventHandlers(p), { initialProps: params });

    await act(async () => {
      await result.current.handleToggleCam();
    });

    expect(state.cam).toBe(false);
    expect(result.current.captureError).toBe('av.cameraCaptureFailed');
  });

  it('bezeichnet einen fehlgeschlagenen bewussten Ausschaltvorgang der Kamera nicht als Aufnahmefehler', async () => {
    const { params } = makeParams(makeAvState({ cam: true }), {
      setCameraEnabled: vi.fn().mockRejectedValue(new Error('closed')),
    });
    const { result } = renderHook((p: Params) => useWorldEventHandlers(p), { initialProps: params });

    await act(async () => {
      await result.current.handleToggleCam();
    });

    expect(result.current.captureError).toBeNull();
  });

  it('zeigt bei fehlgeschlagenem Share-Start (false) den neutralen Hinweis und lässt den Schalter aus', async () => {
    const { params, state } = makeParams(makeAvState(), {
      startScreenshare: vi.fn().mockResolvedValue(false),
    });
    const { result } = renderHook((p: Params) => useWorldEventHandlers(p), { initialProps: params });

    await act(async () => {
      await result.current.handleToggleShare();
    });

    expect(state.share).toBe(false);
    expect(result.current.captureError).toBe('av.screenshareCaptureFailed');
  });

  it('zeigt bei geworfenem Share-Startfehler den neutralen Hinweis', async () => {
    const { params } = makeParams(makeAvState(), {
      startScreenshare: vi.fn().mockRejectedValue(new Error('capture failed')),
    });
    const { result } = renderHook((p: Params) => useWorldEventHandlers(p), { initialProps: params });

    await act(async () => {
      await result.current.handleToggleShare();
    });

    expect(result.current.captureError).toBe('av.screenshareCaptureFailed');
  });

  it('bezeichnet einen Share-Stopp nicht als Aufnahmefehler', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const { params } = makeParams(makeAvState({ share: true }), { stopScreenshare: stop });
    const { result } = renderHook((p: Params) => useWorldEventHandlers(p), { initialProps: params });

    await act(async () => {
      await result.current.handleToggleShare();
    });

    expect(stop).toHaveBeenCalled();
    expect(result.current.captureError).toBeNull();
  });

  it('legt keine rohen Fehler- oder Gerätenamen in den Hinweis-Key', async () => {
    const { params } = makeParams(makeAvState(), {
      setMicrophoneEnabled: vi.fn().mockRejectedValue(new Error('NotFoundError: Microphone XYZ missing')),
    });
    const { result } = renderHook((p: Params) => useWorldEventHandlers(p), { initialProps: params });

    await act(async () => {
      await result.current.handleToggleMic();
    });

    expect(String(result.current.captureError)).not.toMatch(/notfound|microphone xyz|permission denied/i);
  });
});
