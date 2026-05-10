import React from 'react';
import type { WorldRoom } from '../../types/colyseus';

export function useZones(params: {
  editor: { active: boolean; zones: any[] };
  setEditor: (updater: (s: any) => any) => void;
  zoneRef: React.MutableRefObject<any>;
  gameBridge: any;
  colyseusRef: React.MutableRefObject<WorldRoom | null>;
}) {
  const { editor, setEditor, zoneRef, gameBridge, colyseusRef } = params;
  const suppressZoneBroadcastRef = React.useRef(false);
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPayloadRef = React.useRef<any>(null);

  // Mirror editor zones to game overlay and ZoneManager; broadcast optionally via Colyseus
  React.useEffect(() => {
    const zonesToShow = editor.active ? editor.zones : [];
    try {
      gameBridge.setZoneOverlay(zonesToShow);
    } catch {}
    if (editor.active) {
      try {
        zoneRef.current?.setZones?.(editor.zones as any);
      } catch {}
    }

    if (suppressZoneBroadcastRef.current) return;

    // Debounce Broadcast (coalesce schnelle Änderungen)
    lastPayloadRef.current = { type: 'zone', polys: editor.zones || [] };
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      try {
        colyseusRef.current?.send?.('editor_update', lastPayloadRef.current);
      } catch {}
      debounceTimerRef.current = null;
    }, 150);
  }, [editor.active, editor.zones]);

  // Handle incoming zone updates (should be called by Colyseus message handler)
  const applyIncomingZones = React.useCallback(
    (polys: any[]) => {
      suppressZoneBroadcastRef.current = true;
      setEditor((s) => ({ ...s, zones: polys }));
      try {
        gameBridge.setZoneOverlay(polys);
      } catch {}
      try {
        zoneRef.current?.setZones?.(polys as any);
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
