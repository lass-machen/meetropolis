// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../app/providers/i18n';
import { EditorWindow } from './EditorWindow';
import { EditorService } from '../../services/EditorService';

vi.mock('../../ui/editor/EditorPanel', () => ({ EditorPanel: () => null }));
vi.mock('../../lib/apiBase', () => ({ getApiBaseFromWindow: () => 'http://api.test' }));

const PACK = { id: 7, name: 'Office', version: '1.0.0', author: 'Team', uuid: 'u-7' };

function stubApi() {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(method === 'GET' ? [PACK] : { ok: true }),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const deletes = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');

beforeEach(() => {
  // The desktop shell has no usable window.confirm; the editor must not call it.
  vi.stubGlobal('confirm', vi.fn());
  vi.stubGlobal('location', { ...window.location, reload: vi.fn() });
  act(() => EditorService.dispatch({ type: 'ACTIVATE_EDITOR', category: 'terrain' }));
});

afterEach(() => {
  act(() => EditorService.dispatch({ type: 'DEACTIVATE_EDITOR' }));
  vi.unstubAllGlobals();
});

describe('EditorWindow pack deletion', () => {
  async function askDelete() {
    render(<EditorWindow onSave={() => Promise.resolve(true)} onClose={() => {}} />);
    fireEvent.click(await screen.findByLabelText('Delete pack'));
  }

  it('deletes a pack only after the in-app confirmation', async () => {
    const fetchMock = stubApi();
    await askDelete();

    expect(screen.getByText('Really delete pack "Office"?')).toBeTruthy();
    expect(deletes(fetchMock)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(deletes(fetchMock)).toHaveLength(1));
    expect(String(deletes(fetchMock)[0][0])).toBe('http://api.test/asset-packs/7');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps the pack when the confirmation is cancelled', async () => {
    const fetchMock = stubApi();
    await askDelete();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText('Really delete pack "Office"?')).toBeNull());
    expect(deletes(fetchMock)).toHaveLength(0);
  });
});
