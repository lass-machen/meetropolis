import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ObjectPropertiesPanel } from './ObjectPropertiesPanel';
import { EditorService, type MapObjectRecord } from '../../services/EditorService';

function makeObject(overrides: Partial<MapObjectRecord> = {}): MapObjectRecord {
  return {
    id: 42,
    assetPackUuid: 'pack-a',
    itemId: 'chair',
    category: 'objects',
    tileX: 3,
    tileY: 4,
    width: 16,
    height: 16,
    collide: true,
    zIndex: 1,
    scaleFactor: 1,
    rotation: 0,
    collisionBaseHeight: 2,
    ...overrides,
  };
}

function fieldInput(label: string): HTMLInputElement {
  const labelEl = screen.getByText(label);
  const input = labelEl.parentElement?.querySelector('input');
  if (!input) throw new Error(`no input for label ${label}`);
  return input;
}

function applyButton(): HTMLElement {
  return screen.getByRole('button', { name: /Übernehmen/i });
}

function lastObjectUpdate(spy: {
  mock: { calls: unknown[][] };
}): { objectId: number | string; updates: Partial<MapObjectRecord> } | undefined {
  const matches = spy.mock.calls
    .map((call) => call[0])
    .filter((action): action is { type: string; objectId: number | string; updates: Partial<MapObjectRecord> } => {
      return (
        typeof action === 'object' &&
        action !== null &&
        (action as { type?: string }).type === 'ADD_PENDING_OBJECT_UPDATE'
      );
    });
  const last = matches[matches.length - 1];
  if (!last) return undefined;
  return { objectId: last.objectId, updates: last.updates };
}

describe('ObjectPropertiesPanel collisionBaseHeight', () => {
  beforeEach(() => {
    EditorService.reset();
  });

  afterEach(() => {
    EditorService.reset();
    vi.restoreAllMocks();
  });

  it('shows the existing collisionBaseHeight value', () => {
    render(<ObjectPropertiesPanel object={makeObject({ collisionBaseHeight: 2 })} />);
    expect(fieldInput('Base Height')).toHaveValue(2);
  });

  it('sends collisionBaseHeight on Apply', () => {
    const spy = vi.spyOn(EditorService, 'dispatch');
    render(<ObjectPropertiesPanel object={makeObject({ collisionBaseHeight: 2 })} />);

    fireEvent.change(fieldInput('Base Height'), { target: { value: '3' } });
    fireEvent.click(applyButton());

    const update = lastObjectUpdate(spy);
    expect(update?.objectId).toBe(42);
    expect(update?.updates.collisionBaseHeight).toBe(3);
  });

  it('syncs the field when the selected object changes', () => {
    const first = makeObject({ id: 1, collisionBaseHeight: 2 });
    const second = makeObject({ id: 2, collisionBaseHeight: 5 });
    const { rerender } = render(<ObjectPropertiesPanel object={first} />);
    expect(fieldInput('Base Height')).toHaveValue(2);

    rerender(<ObjectPropertiesPanel object={second} />);
    expect(fieldInput('Base Height')).toHaveValue(5);
  });

  it('accepts 0 as a valid collisionBaseHeight', () => {
    const spy = vi.spyOn(EditorService, 'dispatch');
    render(<ObjectPropertiesPanel object={makeObject({ collisionBaseHeight: 2 })} />);

    fireEvent.change(fieldInput('Base Height'), { target: { value: '0' } });
    fireEvent.click(applyButton());

    expect(lastObjectUpdate(spy)?.updates.collisionBaseHeight).toBe(0);
  });

  it('disables Apply for negative or fractional collisionBaseHeight and recovers', () => {
    const spy = vi.spyOn(EditorService, 'dispatch');
    render(<ObjectPropertiesPanel object={makeObject({ collisionBaseHeight: 2 })} />);
    const heightInput = fieldInput('Base Height');

    fireEvent.change(heightInput, { target: { value: '-1' } });
    expect(applyButton()).toBeDisabled();
    expect(heightInput).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(applyButton());
    expect(lastObjectUpdate(spy)).toBeUndefined();

    fireEvent.change(heightInput, { target: { value: '1.5' } });
    expect(applyButton()).toBeDisabled();
    expect(heightInput).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(applyButton());
    expect(lastObjectUpdate(spy)).toBeUndefined();

    fireEvent.change(heightInput, { target: { value: '4' } });
    expect(applyButton()).not.toBeDisabled();
    expect(heightInput).not.toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(applyButton());
    expect(lastObjectUpdate(spy)?.updates.collisionBaseHeight).toBe(4);
  });
});
