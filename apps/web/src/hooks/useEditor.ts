/**
 * useEditor - React Hook für EditorService
 * 
 * Dünner Wrapper um EditorService mit React Observer Pattern
 * BACKWARDS COMPATIBLE: Gibt Array zurück wie alter Hook
 */

import { useState, useEffect, useCallback } from 'react';
import { EditorService, EditorState } from '../services/EditorService';

// Re-export Types für Backwards Compatibility
export type { EditorState, EditorAction, EditorTool, EditorCategory } from '../services/EditorService';

/**
 * Hook der den EditorService State mit React verbindet
 * @returns Array mit [state, setState-Wrapper] für Backwards Compatibility
 *
 * Wichtig: `setStateWrapper` ist via `useCallback` stabil gehalten. Sonst
 * wechselt seine Identität bei jedem Render und Effekte/Memo-Hooks, die ihn
 * in ihrer Dependency-Liste tragen, feuern bei jedem Render erneut — was im
 * Verbund mit `EditorService.dispatch` (das stets neue State-Objekte
 * publiziert und so via `setState` einen Re-Render anstößt) eine
 * unbegrenzte Update-Schleife auslöst (`Maximum update depth exceeded`).
 */
export function useEditor(): [EditorState, React.Dispatch<React.SetStateAction<EditorState>>] {
  const [state, setState] = useState<EditorState>(EditorService.getState());

  useEffect(() => {
    // Subscribe zu State-Änderungen
    const unsubscribe = EditorService.subscribe((newState) => {
      setState(newState);
    });

    return unsubscribe;
  }, []);

  // Wrapper für setState der funktionale Updates in LOAD_STATE Actions übersetzt.
  // useCallback hält die Identität stabil, damit Consumer-Hooks nicht in
  // Endlos-Render-Loops geraten (siehe JSDoc oben).
  const setStateWrapper = useCallback((update: React.SetStateAction<EditorState>) => {
    if (typeof update === 'function') {
      // Funktionales Update: Führe die Funktion mit aktuellem State aus
      const currentState = EditorService.getState();
      const newState = (update as (s: EditorState) => EditorState)(currentState);
      // Überschreibe via LOAD_STATE action
      EditorService.dispatch({ type: 'LOAD_STATE', state: newState });
    } else {
      // Direktes State-Setting - überschreibe via LOAD_STATE action
      EditorService.dispatch({ type: 'LOAD_STATE', state: update });
    }
  }, []);

  return [state, setStateWrapper as React.Dispatch<React.SetStateAction<EditorState>>];
}


