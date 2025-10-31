import React from 'react';

export function useZones(params: {
  editor: { active: boolean; zones: any[] };
  setEditor: (updater: (s: any) => any) => void;
  zoneRef: React.MutableRefObject<any>;
  gameBridge: any;
  colyseusRef: React.MutableRefObject<any>;
}) {
  const { editor, setEditor, zoneRef, gameBridge, colyseusRef } = params;
  const suppressZoneBroadcastRef = React.useRef(false);

  // Mirror editor zones to game overlay and ZoneManager; broadcast optionally via Colyseus
  React.useEffect(() => {
    const zonesToShow = editor.active ? editor.zones : [];
    try { gameBridge.setZoneOverlay(zonesToShow); } catch {}
    try { zoneRef.current?.setZones?.(editor.zones as any); } catch {}
    try { localStorage.setItem('meetropolis.zones', JSON.stringify(editor.zones || [])); } catch {}
    if (!suppressZoneBroadcastRef.current) {
      try { colyseusRef.current?.send?.('editor_update', { type: 'zone', polys: editor.zones || [] }); } catch {}
    }
  }, [editor.active, editor.zones]);

  // Handle incoming zone updates (should be called by Colyseus message handler)
  const applyIncomingZones = React.useCallback((polys: any[]) => {
    suppressZoneBroadcastRef.current = true;
    setEditor(s => ({ ...s, zones: polys }));
    try { localStorage.setItem('meetropolis.zones', JSON.stringify(polys)); } catch {}
    try { gameBridge.setZoneOverlay(polys); } catch {}
    try { zoneRef.current?.setZones?.(polys as any); } catch {}
    setTimeout(() => { suppressZoneBroadcastRef.current = false; }, 50);
  }, [setEditor, zoneRef, gameBridge]);

  return { applyIncomingZones } as const;
}


