// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import '../../../app/providers/i18n';
import { useTenantSettings } from './useTenantSettings';

vi.mock('../../../lib/apiBase', () => ({ getApiBaseFromWindow: () => 'http://api.test' }));

beforeEach(() => {
  vi.stubGlobal('confirm', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The member list asks for the confirmation before it calls this handler. The
 * handler asked a second time, so removing a member needed two confirmations.
 */
describe('useTenantSettings handleRemoveMember', () => {
  it('removes the member without asking a second time', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useTenantSettings());

    await act(async () => {
      await result.current.handleRemoveMember('m1');
    });

    expect(confirm).not.toHaveBeenCalled();
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.some(([url, init]) => url.endsWith('/users/m1') && init.method === 'DELETE')).toBe(true);
  });
});
