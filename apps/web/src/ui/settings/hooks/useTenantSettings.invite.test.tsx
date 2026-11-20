// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import '../../../app/providers/i18n';
import { useTenantSettings } from './useTenantSettings';

vi.mock('../../../lib/apiBase', () => ({ getApiBaseFromWindow: () => 'http://api.test' }));

function stubInviteApi(emailSent: boolean) {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.endsWith('/auth/invite')) {
        bodies.push(JSON.parse(init.body as string));
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () =>
            Promise.resolve({
              code: 'ABC123',
              role: 'member',
              inviteUrl: 'https://public.example/#/?invite=ABC123',
              expiresAt: '2026-02-01T00:00:00.000Z',
              emailSent,
            }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    }),
  );
  return bodies;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTenantSettings handleInvite delivery', () => {
  it('always sends the email in the body and passes delivery fields through', async () => {
    const bodies = stubInviteApi(true);
    const { result } = renderHook(() => useTenantSettings());

    let invite: Awaited<ReturnType<typeof result.current.handleInvite>> = null;
    await act(async () => {
      invite = await result.current.handleInvite('member@example.test', 'member');
    });

    expect(bodies).toEqual([{ email: 'member@example.test', role: 'member' }]);
    expect(invite).toEqual({
      email: 'member@example.test',
      inviteUrl: 'https://public.example/#/?invite=ABC123',
      emailSent: true,
      expiresAt: '2026-02-01T00:00:00.000Z',
    });
  });

  it('still sends the email key when the field is empty', async () => {
    const bodies = stubInviteApi(false);
    const { result } = renderHook(() => useTenantSettings());

    await act(async () => {
      await result.current.handleInvite('', 'member');
    });

    expect(bodies).toEqual([{ email: '', role: 'member' }]);
  });
});
