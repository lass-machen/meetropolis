import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import i18n from '../../app/providers/i18n';
import { EditorPanel } from './EditorPanel';
import { EditorService } from '../../services/EditorService';
import { useMapStore } from '../../state/mapStore';

describe('EditorPanel accessibility', () => {
  let previousLanguage = 'en';

  beforeEach(async () => {
    previousLanguage = i18n.language || 'en';
    await i18n.changeLanguage('en');
    act(() => EditorService.reset());
    useMapStore.setState({ currentMapId: '' });
  });

  afterEach(async () => {
    act(() => EditorService.reset());
    useMapStore.setState({ currentMapId: '' });
    await act(async () => {
      await i18n.changeLanguage(previousLanguage || 'en');
    });
  });

  it('labels the space background color input', async () => {
    // The default category renders the general settings with the space background input.
    const { container } = render(<EditorPanel onSave={() => Promise.resolve(true)} />);
    await screen.findByDisplayValue('#111827');
    const result = await axe.run(container, { runOnly: { type: 'rule', values: ['label'] } });
    expect(result.violations).toEqual([]);
  });

  it('labels the terrain background color input', async () => {
    // The terrain settings (with the terrain background input) only render for that category.
    act(() => EditorService.dispatch({ type: 'SET_CATEGORY', category: 'terrain' }));
    const { container } = render(<EditorPanel onSave={() => Promise.resolve(true)} />);
    await screen.findByDisplayValue('#202020');
    const result = await axe.run(container, { runOnly: { type: 'rule', values: ['label'] } });
    expect(result.violations).toEqual([]);
  });
});
