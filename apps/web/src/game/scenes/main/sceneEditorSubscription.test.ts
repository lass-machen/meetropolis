import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { EditorService } from '../../../services/EditorService';
import { subscribeToSceneEditor } from './sceneEditorSubscription';

describe('sceneEditorSubscription', () => {
  beforeEach(() => {
    EditorService.reset();
  });

  afterEach(() => {
    EditorService.reset();
  });

  it('delivers before scene end and stops after shutdown', () => {
    const events = new EventEmitter();
    let deliveries = 0;
    const callback = () => {
      deliveries += 1;
    };
    const cleanup = subscribeToSceneEditor(events, callback);

    try {
      EditorService.dispatch({ type: 'ACTIVATE_EDITOR' });
      expect(deliveries).toBe(1);

      events.emit('shutdown');

      EditorService.dispatch({ type: 'SET_TOOL', tool: 'zone' });
      expect(deliveries).toBe(1);
    } finally {
      cleanup();
      events.removeAllListeners();
    }
  });

  it('stops after destroy without shutdown', () => {
    const events = new EventEmitter();
    let deliveries = 0;
    const callback = () => {
      deliveries += 1;
    };
    const cleanup = subscribeToSceneEditor(events, callback);

    try {
      events.emit('destroy');

      EditorService.dispatch({ type: 'ACTIVATE_EDITOR' });
      expect(deliveries).toBe(0);
    } finally {
      cleanup();
      events.removeAllListeners();
    }
  });

  it('only the current callback survives repeated mount and shutdown cycles', () => {
    const events = new EventEmitter();
    let firstDeliveries = 0;
    let secondDeliveries = 0;
    const firstCallback = () => {
      firstDeliveries += 1;
    };
    const secondCallback = () => {
      secondDeliveries += 1;
    };

    const firstCleanup = subscribeToSceneEditor(events, firstCallback);
    EditorService.dispatch({ type: 'ACTIVATE_EDITOR' });
    expect(firstDeliveries).toBe(1);

    events.emit('shutdown');
    firstCleanup();
    EditorService.reset();

    const secondCleanup = subscribeToSceneEditor(events, secondCallback);
    try {
      EditorService.dispatch({ type: 'ACTIVATE_EDITOR' });
      expect(secondDeliveries).toBe(1);
      expect(firstDeliveries).toBe(1);
    } finally {
      secondCleanup();
      events.removeAllListeners();
    }
  });

  it('removes lifecycle listeners after cleanup', () => {
    const events = new EventEmitter();
    const callback = () => {};
    const cleanup = subscribeToSceneEditor(events, callback);

    cleanup();

    expect(events.listenerCount('shutdown')).toBe(0);
    expect(events.listenerCount('destroy')).toBe(0);
    events.removeAllListeners();
  });
});
