import React from 'react';

interface WorldContextMenuProps {
  contextMenu: { open: boolean; x: number; y: number; playerId: string | null };
  onClose: () => void;
  localPosRef: React.RefObject<{ id: string; x?: number; y?: number }>;
  bubbleGroupsRef: React.RefObject<Record<string, string>>;
  followRef: React.RefObject<any>;
  gameBridge: any;
  colyseusRef: React.RefObject<any>;
  bubbleStartRef: React.RefObject<null | ((id: string) => void)>;
}

export function WorldContextMenu({
  contextMenu,
  onClose,
  localPosRef,
  bubbleGroupsRef,
  followRef,
  gameBridge,
  colyseusRef,
  bubbleStartRef,
}: WorldContextMenuProps) {
  if (!contextMenu.open || !contextMenu.playerId) {
    return null;
  }

  const handleFollowClick = () => {
    onClose();
    const id = contextMenu.playerId!;
    // Toggle follow
    if (followRef.current?.getTarget?.() === id) {
      followRef.current.stop();
      gameBridge.setDesiredPosition(null);
    } else {
      followRef.current?.startFollowing?.(id);
    }
  };

  const handleJoinBubbleClick = () => {
    onClose();
    try {
      const target = contextMenu.playerId!;
      const targetGroup = bubbleGroupsRef.current?.[target];
      const meId = localPosRef.current?.id;
      if (!target || !targetGroup || !meId) return;
      // Mitglieder der Ziel-Bubble + mich
      const currentMembers = Object.entries(bubbleGroupsRef.current || {})
        .filter(([, _gid]) => _gid === targetGroup)
        .map(([sid]) => sid);
      const next = Array.from(new Set([...currentMembers, meId]));
      colyseusRef.current?.send?.('bubble_update', { id: targetGroup, members: next });
    } catch { }
  };

  const handleAddToBubbleClick = () => {
    onClose();
    try {
      const id = contextMenu.playerId!;
      const meId = localPosRef.current?.id;
      if (!meId || !id || meId === id) return;
      const myGroup = bubbleGroupsRef.current?.[meId];
      if (!myGroup) return;
      // Bilde neue Menge: bestehende Gruppenmitglieder + Zielspieler
      const currentMembers = Object.entries(bubbleGroupsRef.current || {})
        .filter(([, _gid]) => _gid === myGroup)
        .map(([sid]) => sid);
      const next = Array.from(new Set([...currentMembers, id]));
      colyseusRef.current?.send?.('bubble_update', { id: myGroup, members: next });
    } catch { }
  };

  const handleStartBubbleClick = () => {
    onClose();
    const id = contextMenu.playerId!;
    bubbleStartRef.current?.(id);
  };

  // Check if we should show "Join Bubble" button
  const shouldShowJoinBubble = (() => {
    try {
      const target = contextMenu.playerId!;
      const targetGroup = target ? (bubbleGroupsRef.current?.[target] || null) : null;
      const meId = localPosRef.current?.id;
      const myGroup = meId ? (bubbleGroupsRef.current?.[meId] || null) : null;
      return !!targetGroup && targetGroup !== myGroup;
    } catch {
      return false;
    }
  })();

  // Check if we should show "Add to Bubble" button
  const shouldShowAddToBubble = (() => {
    try {
      const meId = localPosRef.current?.id;
      const myGroup = meId ? (bubbleGroupsRef.current?.[meId] || null) : null;
      return !!myGroup;
    } catch {
      return false;
    }
  })();

  return (
    <div
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'absolute', inset: 0, zIndex: 60 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: Math.min(Math.max(8, contextMenu.x), window.innerWidth - 196),
          top: Math.min(Math.max(8, contextMenu.y), window.innerHeight - 96),
          background: 'rgba(17,17,20,0.98)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)'
        }}
      >
        <button
          onClick={handleFollowClick}
          style={{
            display: 'block',
            padding: '8px 12px',
            background: 'transparent',
            color: '#fff',
            border: 'none',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            width: 180,
            textAlign: 'left',
            cursor: 'pointer'
          }}
        >
          Folgen
        </button>

        {shouldShowJoinBubble && (
          <button
            onClick={handleJoinBubbleClick}
            style={{
              display: 'block',
              padding: '8px 12px',
              background: 'transparent',
              color: '#fff',
              border: 'none',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              width: 180,
              textAlign: 'left',
              cursor: 'pointer'
            }}
          >
            Bubble beitreten
          </button>
        )}

        {shouldShowAddToBubble && (
          <button
            onClick={handleAddToBubbleClick}
            style={{
              display: 'block',
              padding: '8px 12px',
              background: 'transparent',
              color: '#fff',
              border: 'none',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              width: 180,
              textAlign: 'left',
              cursor: 'pointer'
            }}
          >
            Zur Bubble hinzufügen
          </button>
        )}

        <button
          onClick={handleStartBubbleClick}
          style={{
            display: 'block',
            padding: '8px 12px',
            background: 'transparent',
            color: '#fff',
            border: 'none',
            width: 180,
            textAlign: 'left',
            cursor: 'pointer'
          }}
        >
          Bubble starten
        </button>
      </div>
    </div>
  );
}
