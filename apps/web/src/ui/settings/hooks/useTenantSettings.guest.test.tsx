// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import '../../../app/providers/i18n';
import { useTenantSettings } from './useTenantSettings';

vi.mock('../../../lib/apiBase', () => ({ getApiBaseFromWindow: () => 'http://api.test' }));

/** Stubs fetch: POST /guests is recorded and answered with a magic link, everything else is empty. */
function stubApi() {
  const posts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.endsWith('/guests')) {
        posts.push(JSON.parse(init.body as string));
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ magicLink: 'http://x/y' }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    }),
  );
  return posts;
}

async function createGuest(name: string) {
  const posts = stubApi();
  const { result } = renderHook(() => useTenantSettings());
  await act(async () => {
    await result.current.handleCreateGuest('guest@example.test', name, '2030-01-01T00:00:00.000Z');
  });
  return posts;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTenantSettings handleCreateGuest name', () => {
  it('sends the name trimmed', async () => {
    const posts = await createGuest('  Jörg Müller ');

    expect(posts).toEqual([
      { email: 'guest@example.test', name: 'Jörg Müller', expiresAt: '2030-01-01T00:00:00.000Z' },
    ]);
  });

  it.each([
    ['empty', ''],
    ['blank', '  \t '],
  ])('leaves the optional name out when it is %s, since the server rejects a blank one', async (_label, name) => {
    const posts = await createGuest(name);

    expect(posts).toEqual([{ email: 'guest@example.test', expiresAt: '2030-01-01T00:00:00.000Z' }]);
    expect(posts[0]).not.toHaveProperty('name');
  });
});
