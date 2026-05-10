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

function getMembersOfGroup(groupId: string, bubbleGroups: Record<string, string>): string[] {
  return Object.entries(bubbleGroups)
    .filter(([, gid]) => gid === groupId)
    .map(([sid]) => sid);
}

function buildContextMenuActions(props: WorldContextMenuProps) {
  const { contextMenu, onClose, localPosRef, bubbleGroupsRef, followRef, gameBridge, colyseusRef, bubbleStartRef } =
    props;

  const handleFollowClick = () => {
    onClose();
    const id = contextMenu.playerId!;
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
      const currentMembers = getMembersOfGroup(targetGroup, bubbleGroupsRef.current || {});
      const next = Array.from(new Set([...currentMembers, meId]));
      colyseusRef.current?.send?.('bubble_update', { id: targetGroup, members: next });
    } catch {}
  };

  const handleAddToBubbleClick = () => {
    onClose();
    try {
      const id = contextMenu.playerId!;
      const meId = localPosRef.current?.id;
      if (!meId || !id || meId === id) return;
      const myGroup = bubbleGroupsRef.current?.[meId];
      if (!myGroup) return;
      const currentMembers = getMembersOfGroup(myGroup, bubbleGroupsRef.current || {});
      const next = Array.from(new Set([...currentMembers, id]));
      colyseusRef.current?.send?.('bubble_update', { id: myGroup, members: next });
    } catch {}
  };

  const handleStartBubbleClick = () => {
    onClose();
    const id = contextMenu.playerId!;
    bubbleStartRef.current?.(id);
  };

  const shouldShowJoinBubble = (() => {
    try {
      const target = contextMenu.playerId!;
      const targetGroup = target ? bubbleGroupsRef.current?.[target] || null : null;
      const meId = localPosRef.current?.id;
      const myGroup = meId ? bubbleGroupsRef.current?.[meId] || null : null;
      return !!targetGroup && targetGroup !== myGroup;
    } catch {
      return false;
    }
  })();

  const shouldShowAddToBubble = (() => {
    try {
      const meId = localPosRef.current?.id;
      const myGroup = meId ? bubbleGroupsRef.current?.[meId] || null : null;
      return !!myGroup;
    } catch {
      return false;
    }
  })();

  return {
    handleFollowClick,
    handleJoinBubbleClick,
    handleAddToBubbleClick,
    handleStartBubbleClick,
    shouldShowJoinBubble,
    shouldShowAddToBubble,
  };
}

function MenuButton({
  onClick,
  label,
  withBorder = true,
}: {
  onClick: () => void;
  label: string;
  withBorder?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        padding: '8px 12px',
        background: 'transparent',
        color: '#fff',
        border: 'none',
        ...(withBorder ? { borderBottom: '1px solid rgba(255,255,255,0.08)' } : {}),
        width: 180,
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

export function WorldContextMenu(props: WorldContextMenuProps) {
  const { contextMenu, onClose } = props;
  if (!contextMenu.open || !contextMenu.playerId) return null;

  const actions = buildContextMenuActions(props);
  const {
    handleFollowClick,
    handleJoinBubbleClick,
    handleAddToBubbleClick,
    handleStartBubbleClick,
    shouldShowJoinBubble,
    shouldShowAddToBubble,
  } = actions;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'absolute', inset: 0, zIndex: 60 }}
    >
      <div
        role="menu"
        tabIndex={0}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          } else {
            e.stopPropagation();
          }
        }}
        style={{
          position: 'absolute',
          left: Math.min(Math.max(8, contextMenu.x), window.innerWidth - 196),
          top: Math.min(Math.max(8, contextMenu.y), window.innerHeight - 96),
          background: 'rgba(17,17,20,0.98)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}
      >
        <MenuButton onClick={handleFollowClick} label="Folgen" />
        {shouldShowJoinBubble && <MenuButton onClick={handleJoinBubbleClick} label="Bubble beitreten" />}
        {shouldShowAddToBubble && <MenuButton onClick={handleAddToBubbleClick} label="Zur Bubble hinzufügen" />}
        <MenuButton onClick={handleStartBubbleClick} label="Bubble starten" withBorder={false} />
      </div>
    </div>
  );
}
