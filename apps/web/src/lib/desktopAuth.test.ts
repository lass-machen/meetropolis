import { describe, it, expect, vi, beforeEach } from 'vitest';

const setDesktopAuthToken = vi.fn();
const getDesktopModule = vi.fn();

vi.mock('./desktopLoader', () => ({
  getDesktopModule: () => getDesktopModule(),
}));

import { storeDesktopAuthToken, clearDesktopAuthToken } from './desktopAuth';

describe('desktopAuth token bridge', () => {
  beforeEach(() => {
    setDesktopAuthToken.mockReset();
    getDesktopModule.mockReset();
  });

  it('persists the token through the desktop module on login', async () => {
    getDesktopModule.mockResolvedValue({ setDesktopAuthToken });
    await storeDesktopAuthToken('jwt-abc');
    expect(setDesktopAuthToken).toHaveBeenCalledWith('jwt-abc');
  });

  it('clears the token through the desktop module on logout', async () => {
    getDesktopModule.mockResolvedValue({ setDesktopAuthToken });
    await clearDesktopAuthToken();
    expect(setDesktopAuthToken).toHaveBeenCalledWith(null);
  });

  it('is a no-op when the desktop module is absent (OSS build)', async () => {
    getDesktopModule.mockResolvedValue(null);
    await expect(storeDesktopAuthToken('jwt-abc')).resolves.toBeUndefined();
    await expect(clearDesktopAuthToken()).resolves.toBeUndefined();
    expect(setDesktopAuthToken).not.toHaveBeenCalled();
  });

  it('never throws when the desktop module rejects', async () => {
    getDesktopModule.mockRejectedValue(new Error('boom'));
    await expect(storeDesktopAuthToken('jwt-abc')).resolves.toBeUndefined();
    await expect(clearDesktopAuthToken()).resolves.toBeUndefined();
  });
});
