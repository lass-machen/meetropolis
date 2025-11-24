/**
 * useEditor - React Hook für EditorService
 * 
 * Dünner Wrapper um EditorService mit React Observer Pattern
 * BACKWARDS COMPATIBLE: Gibt Array zurück wie alter Hook
 */

import { useState, useEffect } from 'react';
import { EditorService, EditorState, EditorAction } from '../services/EditorService';

// Re-export Types für Backwards Compatibility
export type { EditorState, EditorAction, EditorTool, EditorCategory } from '../services/EditorService';

/**
 * Hook der den EditorService State mit React verbindet
 * @returns Array mit [state, setState-Wrapper] für Backwards Compatibility
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

  // Wrapper für setState der funktionale Updates in LOAD_STATE Actions übersetzt
  const setStateWrapper = (update: React.SetStateAction<EditorState>) => {
    if (typeof update === 'function') {
      // Funktionales Update: Führe die Funktion mit aktuellem State aus
      const currentState = EditorService.getState();
      const newState = update(currentState);
      // Überschreibe via LOAD_STATE action
      EditorService.dispatch({ type: 'LOAD_STATE', state: newState });
    } else {
      // Direktes State-Setting - überschreibe via LOAD_STATE action
      EditorService.dispatch({ type: 'LOAD_STATE', state: update });
    }
  };

  return [state, setStateWrapper as any];
}


