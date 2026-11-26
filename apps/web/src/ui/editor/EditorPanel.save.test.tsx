import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from '../../app/providers/i18n';
import { EditorPanel } from './EditorPanel';
import { EditorService } from '../../services/EditorService';
import { useMapStore } from '../../state/mapStore';

describe('EditorPanel save', () => {
  let previousLanguage = 'en';

  beforeEach(async () => {
    previousLanguage = i18n.language || 'en';
    await i18n.changeLanguage('en');
    act(() => EditorService.reset());
    useMapStore.setState({ currentMapId: '' });
    act(() => EditorService.dispatch({ type: 'MARK_ZONES_MODIFIED' }));
  });

  afterEach(async () => {
    act(() => EditorService.reset());
    useMapStore.setState({ currentMapId: '' });
    await act(async () => {
      await i18n.changeLanguage(previousLanguage || 'en');
    });
  });

  it('does not report success when onSave returns false', async () => {
    render(<EditorPanel onSave={() => Promise.resolve(false)} />);

    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Save/i })).not.toBeDisabled());
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByText('Not saved yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Save \(1\)/i })).toBeTruthy();
  });

  it('reports success when onSave returns true', async () => {
    render(<EditorPanel onSave={() => Promise.resolve(true)} />);

    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
    expect(screen.queryByText('Not saved yet')).toBeNull();
  });

  it('shows an error and keeps pending changes when onSave throws', async () => {
    render(<EditorPanel onSave={() => Promise.reject(new Error('boom'))} />);

    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => expect(screen.getByText('Save failed')).toBeTruthy());
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByRole('button', { name: /Save \(1\)/i })).toBeTruthy();
  });
});
