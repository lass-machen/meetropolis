import React from 'react';

type EditorState = any;

export function useEditorBridge(params: {
  editor: EditorState;
  setEditor: (updater: (s: EditorState) => EditorState) => void;
  gameBridge: any;
}) {
  const { editor, setEditor, gameBridge } = params;
  const editorActiveRef = React.useRef(false);
  React.useEffect(() => { editorActiveRef.current = !!editor.active; }, [editor.active]);

  React.useEffect(() => {
    const tileSize = 16;

    const setRectPx = (drag: { startTileX: number; startTileY: number; endTileX: number; endTileY: number }) => {
      try {
        const x0 = Math.min(drag.startTileX, drag.endTileX) * tileSize;
        const y0 = Math.min(drag.startTileY, drag.endTileY) * tileSize;
        const x1 = (Math.max(drag.startTileX, drag.endTileX) + 1) * tileSize;
        const y1 = (Math.max(drag.startTileY, drag.endTileY) + 1) * tileSize;
        gameBridge.setSelectionRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      } catch {}
    };

    const handleDown = ({ tileX, tileY }: { tileX: number; tileY: number }) => {
      if (!editorActiveRef.current) return;
      setEditor(s => ({ ...s, drag: { startTileX: tileX, startTileY: tileY, endTileX: tileX, endTileY: tileY }, lastTile: { tileX, tileY } }));
      setRectPx({ startTileX: tileX, startTileY: tileY, endTileX: tileX, endTileY: tileY });
    };

    const handleMove = ({ tileX, tileY }: { tileX: number; tileY: number }) => {
      if (!editorActiveRef.current) return;
      setEditor(s => {
        if (!s.drag) return s;
        const drag = { ...s.drag, endTileX: tileX, endTileY: tileY };
        setRectPx(drag);
        return { ...s, drag };
      });
    };

    const handleUp = ({ tileX, tileY }: { tileX: number; tileY: number }) => {
      if (!editorActiveRef.current) return;
      setEditor(s => {
        if (!s.drag) return { ...s, lastTile: { tileX, tileY } } as any;
        try { gameBridge.setSelectionRect(null); } catch {}
        return { ...s, drag: null, lastTile: { tileX, tileY } } as any;
      });
    };

    try {
      gameBridge.onPointerDownTile = handleDown;
      gameBridge.onPointerMoveTile = handleMove;
      gameBridge.onPointerUpTile = handleUp;
    } catch {}

    return () => {
      try {
        gameBridge.onPointerDownTile = () => {};
        gameBridge.onPointerMoveTile = () => {};
        gameBridge.onPointerUpTile = () => {};
      } catch {}
    };
  }, [editor.active]);
}


