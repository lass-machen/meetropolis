import type { UseWorldRoomArgs } from '../types';
import type { BubbleStateMessage, WorldRoom } from '../../types/colyseus';

export function setupBubbleHandlers(room: WorldRoom, args: UseWorldRoomArgs) {
  const {
    localPosRef,
    remotesRef,
    colyseusToLivekitMap,
    identityToNameMap,
    gameBridge,
    bubbleMembersRef,
    bubbleGroupsRef,
    setBubbleUi,
    applyVolumesToUi,
  } = args;

  room.onMessage('bubble_state', (payload: BubbleStateMessage) => {
    const membersArr = Array.isArray(payload?.members) ? payload.members : [];
    // Groups -> mapping
    const groupsArr = Array.isArray(payload?.groups) ? payload.groups : null;
    const mapping: Record<string, string> = {};
    if (groupsArr) {
      for (const g of groupsArr) {
        const gid = String(g?.id || '');
        const ms = Array.isArray(g?.members) ? g.members : [];
        if (!gid || ms.length < 2) continue;
        for (const id of ms) mapping[id] = gid;
      }
    } else if (membersArr.length >= 2) {
      // Legacy: alle Mitglieder als eine Bubble
      const gid = 'legacy';
      for (const id of membersArr) mapping[id] = gid;
    }
    try {
      bubbleGroupsRef.current = mapping;
    } catch {}
    const incoming = new Set<string>(membersArr);
    // Filter out members not on the same map (defense-in-depth)
    const localId = localPosRef.current.id;
    for (const id of incoming) {
      if (id === localId) continue; // keep self
      if (!remotesRef.current[id]) incoming.delete(id); // not on same map
    }
    // Sync bubbleMembersRef used by VolumeManager providers
    try {
      bubbleMembersRef.current.clear();
      for (const id of incoming) bubbleMembersRef.current.add(id);
    } catch {}
    const visual = new Set<string>();
    const amInBubble = !!(localPosRef.current.id && incoming.has(localPosRef.current.id));
    if (gameBridge && typeof gameBridge.setMovementLocked === 'function') gameBridge.setMovementLocked(!!amInBubble);
    if (localPosRef.current.id && incoming.has(localPosRef.current.id)) visual.add('__local__');
    for (const id of incoming) {
      if (id !== localPosRef.current.id) visual.add(id);
    }
    if (gameBridge && typeof gameBridge.setBubbleMembers === 'function') gameBridge.setBubbleMembers(visual);
    applyVolumesToUi();
    // UI names
    const names: string[] = [];
    for (const id of incoming) {
      if (id === localPosRef.current.id) continue;
      const identity = colyseusToLivekitMap.current[id] || id;
      const name = identityToNameMap.current[identity] || identity;
      names.push(name);
    }
    setBubbleUi({ active: amInBubble && incoming.size > 1, members: names });
  });
}
