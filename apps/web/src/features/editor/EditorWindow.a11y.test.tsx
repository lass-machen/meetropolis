// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import '../../app/providers/i18n';
import { EditorWindow } from './EditorWindow';
import { EditorService } from '../../services/EditorService';

vi.mock('../../ui/editor/EditorPanel', () => ({ EditorPanel: () => null }));
vi.mock('../../lib/apiBase', () => ({ getApiBaseFromWindow: () => 'http://api.test' }));

function stubApi() {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  // The desktop shell has no usable window.confirm; the editor must not call it.
  vi.stubGlobal('confirm', vi.fn());
  vi.stubGlobal('location', { ...window.location, reload: vi.fn() });
  stubApi();
  act(() => EditorService.dispatch({ type: 'ACTIVATE_EDITOR', category: 'terrain' }));
});

afterEach(() => {
  act(() => EditorService.dispatch({ type: 'DEACTIVATE_EDITOR' }));
  vi.unstubAllGlobals();
});

describe('EditorWindow accessibility', () => {
  it('has no nested-interactive violation in the header', async () => {
    const { container } = render(<EditorWindow onSave={() => Promise.resolve(true)} onClose={() => {}} />);
    // Wait until the header with its controls has rendered.
    await screen.findByText('Map-Editor');
    const result = await axe.run(container, { runOnly: { type: 'rule', values: ['nested-interactive'] } });
    expect(result.violations).toEqual([]);
  });
});
