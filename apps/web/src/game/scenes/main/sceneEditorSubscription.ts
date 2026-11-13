import { EditorService } from '../../../services/EditorService';
import type { EditorListener } from '../../../services/EditorTypes';

export interface SceneLifecycleEvents {
  once(event: 'shutdown' | 'destroy', listener: () => void): unknown;
  off(event: 'shutdown' | 'destroy', listener: () => void): unknown;
}

export function subscribeToSceneEditor(events: SceneLifecycleEvents, listener: EditorListener): () => void {
  const unsubscribe = EditorService.subscribe(listener);

  let disposed = false;

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    events.off('shutdown', onShutdown);
    events.off('destroy', onDestroy);
  }

  function onShutdown(): void {
    dispose();
  }

  function onDestroy(): void {
    dispose();
  }

  events.once('shutdown', onShutdown);
  events.once('destroy', onDestroy);

  return dispose;
}
