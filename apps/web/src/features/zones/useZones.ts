import React from 'react';
import type { WorldRoom } from '../../types/colyseus';
import type { GameBridge } from '../../types/game';
import type { ZoneManager } from '../../game/zoneManager';
import type { Zone, EditorState } from '../../services/EditorTypes';

interface ZonePayload {
  type: 'zone';
  polys: Zone[];
}

export function useZones(params: {
  editor: { active: boolean; zones: Zone[] };
  setEditor: (updater: (s: EditorState) => EditorState) => void;
  zoneRef: React.MutableRefObject<ZoneManager | null>;
  gameBridge: GameBridge;
  colyseusRef: React.MutableRefObject<WorldRoom | null>;
}) {
  const { editor, setEditor, zoneRef, gameBridge, colyseusRef } = params;
  const suppressZoneBroadcastRef = React.useRef(false);
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPayloadRef = React.useRef<ZonePayload | null>(null);

  // Mirror editor zones to game overlay and ZoneManager; broadcast optionally via Colyseus
  React.useEffect(() => {
    const zonesToShow = editor.active ? editor.zones : [];
    try {
      gameBridge.setZoneOverlay(zonesToShow);
    } catch {}
    if (editor.active) {
      try {
        zoneRef.current?.setZones(editor.zones);
      } catch {}
    }

    if (suppressZoneBroadcastRef.current) return;

    // Debounce the broadcast to coalesce rapid changes.
    lastPayloadRef.current = { type: 'zone', polys: editor.zones || [] };
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      try {
        if (lastPayloadRef.current) {
          colyseusRef.current?.send('editor_update', lastPayloadRef.current);
        }
      } catch {}
      debounceTimerRef.current = null;
    }, 150);
  }, [editor.active, editor.zones]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: editor refs are stable; only zone data and active state should retrigger

  // Handle incoming zone updates (should be called by Colyseus message handler)
  const applyIncomingZones = React.useCallback(
    (polys: Zone[]) => {
      suppressZoneBroadcastRef.current = true;
      setEditor((s) => ({ ...s, zones: polys }));
      try {
        gameBridge.setZoneOverlay(polys);
      } catch {}
      try {
        zoneRef.current?.setZones(polys);
      } catch {}
      // Cancel pending debounced send; re-allow broadcasting nach kurzer Pause
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      setTimeout(() => {
        suppressZoneBroadcastRef.current = false;
      }, 100);
    },
    [setEditor, zoneRef, gameBridge],
  );

  return { applyIncomingZones } as const;
}
