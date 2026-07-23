/**
 * useEditor: thin React adapter around EditorService.
 *
 * Returns the tuple shape kept for backwards compatibility with the previous
 * hook implementation.
 */

import { useState, useEffect, useCallback } from 'react';
import { EditorService, EditorState } from '../services/EditorService';

// Re-export types so existing imports keep working.
export type { EditorState, EditorAction, EditorTool, EditorCategory } from '../services/EditorService';

/**
 * Bind the EditorService state to React render output.
 *
 * @returns Tuple of [state, setState-wrapper] mirroring the legacy hook API.
 *
 * The wrapper is kept stable via `useCallback`. Without that, its identity
 * changes on every render: any effect or memo that lists it as a dependency
 * would refire each render. Combined with `EditorService.dispatch` (which
 * publishes a new state object and triggers a re-render via `setState`),
 * that produces an unbounded update loop (`Maximum update depth exceeded`).
 */
export function useEditor(): [EditorState, React.Dispatch<React.SetStateAction<EditorState>>] {
  const [state, setState] = useState<EditorState>(EditorService.getState());

  useEffect(() => {
    // Forward state changes from the service to React.
    const unsubscribe = EditorService.subscribe((newState) => {
      setState(newState);
    });

    return unsubscribe;
  }, []);

  // Translate functional or direct setState updates into LOAD_STATE actions.
  // `useCallback` keeps the identity stable, see the JSDoc above for why.
  const setStateWrapper = useCallback((update: React.SetStateAction<EditorState>) => {
    if (typeof update === 'function') {
      const currentState = EditorService.getState();
      const newState = update(currentState);
      EditorService.dispatch({ type: 'LOAD_STATE', state: newState });
    } else {
      EditorService.dispatch({ type: 'LOAD_STATE', state: update });
    }
  }, []);

  return [state, setStateWrapper];
}
