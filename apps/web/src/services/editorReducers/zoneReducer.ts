import type { EditorState, EditorAction, Zone } from '../EditorTypes';

const TILE_SIZE = 16;

export type ZoneActions =
  | Extract<EditorAction, { type: 'START_ZONE_DRAG' }>
  | Extract<EditorAction, { type: 'UPDATE_ZONE_DRAG' }>
  | Extract<EditorAction, { type: 'COMPLETE_ZONE' }>
  | Extract<EditorAction, { type: 'DELETE_ZONE' }>
  | Extract<EditorAction, { type: 'START_EDIT_ZONE' }>
  | Extract<EditorAction, { type: 'UPDATE_ZONE_NAME' }>
  | Extract<EditorAction, { type: 'SET_ZONE_NAME' }>
  | Extract<EditorAction, { type: 'UPDATE_ZONE_TYPE' }>
  | Extract<EditorAction, { type: 'UPDATE_ZONE_PORTAL' }>
  | Extract<EditorAction, { type: 'MARK_ZONES_MODIFIED' }>;

function buildZoneFromDrag(state: EditorState, action: Extract<EditorAction, { type: 'COMPLETE_ZONE' }>): { zones: Zone[]; resetEditing: true } {
  const { startTileX, startTileY } = state.dragState!;
  const x0 = Math.min(startTileX, action.tileX) * TILE_SIZE;
  const y0 = Math.min(startTileY, action.tileY) * TILE_SIZE;
  const x1 = (Math.max(startTileX, action.tileX) + 1) * TILE_SIZE;
  const y1 = (Math.max(startTileY, action.tileY) + 1) * TILE_SIZE;

  const zone: Zone = {
    name: action.name || state.zoneName || `Zone ${state.zones.length + 1}`,
    points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
    type: 'default',
  };

  const zones = [...state.zones];
  if (state.editingZoneIndex !== null) {
    const existing = zones[state.editingZoneIndex];
    zones[state.editingZoneIndex] = { ...existing, name: zone.name, points: zone.points };
  } else {
    zones.push(zone);
  }
  return { zones, resetEditing: true };
}

export function reduceZone(state: EditorState, action: ZoneActions): Partial<EditorState> | null {
  switch (action.type) {
    case 'START_ZONE_DRAG':
      return { dragState: { startTileX: action.tileX, startTileY: action.tileY, endTileX: action.tileX, endTileY: action.tileY } };
    case 'UPDATE_ZONE_DRAG':
      if (!state.dragState) throw new Error('Cannot update drag: no drag in progress');
      return { dragState: { ...state.dragState, endTileX: action.tileX, endTileY: action.tileY } };
    case 'COMPLETE_ZONE': {
      if (!state.dragState) throw new Error('Cannot complete zone: no drag in progress');
      const { zones } = buildZoneFromDrag(state, action);
      return { zones, dragState: null, editingZoneIndex: null, zoneName: '' };
    }
    case 'DELETE_ZONE':
      return { zones: state.zones.filter((_, i) => i !== action.index) };
    case 'START_EDIT_ZONE': {
      if (action.index < 0 || action.index >= state.zones.length) throw new Error(`Invalid zone index: ${action.index}`);
      const zone = state.zones[action.index];
      return { editingZoneIndex: action.index, zoneName: zone.name, tool: 'zone' };
    }
    case 'UPDATE_ZONE_NAME': {
      if (action.index < 0 || action.index >= state.zones.length) throw new Error(`Invalid zone index: ${action.index}`);
      const zones = [...state.zones];
      zones[action.index] = { ...zones[action.index], name: action.name };
      return { zones };
    }
    case 'SET_ZONE_NAME':
      return { zoneName: action.name };
    case 'UPDATE_ZONE_TYPE': {
      if (action.index < 0 || action.index >= state.zones.length) throw new Error(`Invalid zone index: ${action.index}`);
      const zones = [...state.zones];
      if (action.zoneType === 'default') {
        const { portalTarget: _pt, portalSpawnX: _px, portalSpawnY: _py, ...rest } = zones[action.index];
        zones[action.index] = { ...rest, type: 'default' };
      } else {
        zones[action.index] = { ...zones[action.index], type: action.zoneType };
      }
      return { zones, pendingChanges: { ...state.pendingChanges, zonesModified: true } };
    }
    case 'UPDATE_ZONE_PORTAL': {
      if (action.index < 0 || action.index >= state.zones.length) throw new Error(`Invalid zone index: ${action.index}`);
      const zones = [...state.zones];
      const updated = { ...zones[action.index] };
      if ('portalTarget' in action) updated.portalTarget = action.portalTarget;
      if ('portalSpawnX' in action) updated.portalSpawnX = action.portalSpawnX;
      if ('portalSpawnY' in action) updated.portalSpawnY = action.portalSpawnY;
      zones[action.index] = updated;
      return { zones, pendingChanges: { ...state.pendingChanges, zonesModified: true } };
    }
    case 'MARK_ZONES_MODIFIED':
      return { pendingChanges: { ...state.pendingChanges, zonesModified: true } };
  }
  return null;
}
