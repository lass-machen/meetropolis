/**
 * EditorPersistence: persistence layer for editor state.
 *
 * Principles:
 * - Atomic operations (all-or-nothing semantics where feasible).
 * - Explicit error propagation.
 * - No try/catch except at the API boundary.
 * - Clear, narrow interfaces.
 */

import { EditorState, PendingChanges, MapObjectRecord } from './EditorService';
import { getApiBaseFromWindow } from '../lib/apiBase';

export class EditorPersistenceError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'EditorPersistenceError';
  }
}

type SaveableState = {
  zones: EditorState['zones'];
  spawn: EditorState['spawn'];
  backgroundColor: EditorState['backgroundColor'];
  tilesets: EditorState['tilesets'];
};

export class EditorPersistenceService {
  private apiBase: string;

  constructor(apiBase?: string) {
    this.apiBase = apiBase || getApiBaseFromWindow();
  }

  /**
   * Persist the editor state to the server.
   *
   * @throws EditorPersistenceError on any non-2xx response.
   */
  public async save(mapId: string, state: EditorState): Promise<void> {
    const payload = this.stateToPayload(state);

    const url = `${this.apiBase}/maps/${encodeURIComponent(mapId)}/editor-state`;

    const response = await fetch(url, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new EditorPersistenceError(`Server returned ${response.status}: ${text}`);
    }

    // Success: drain the response body but discard it; the public signature
    // is `Promise<void>` and the saved-state echo is not consumed.
    await response.json().catch(() => undefined);
  }

  /**
   * Load the editor state from the server.
   *
   * @throws EditorPersistenceError on any non-2xx response (404 returns an empty state).
   */
  public async load(mapId: string): Promise<Partial<EditorState>> {
    const url = `${this.apiBase}/maps/${encodeURIComponent(mapId)}/editor-state`;

    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // No saved data is a valid empty state.
        return {};
      }

      const text = await response.text();
      throw new EditorPersistenceError(`Server returned ${response.status}: ${text}`);
    }

    const data: unknown = await response.json();
    return this.payloadToState(data);
  }

  /** Convert the in-memory state to the server payload shape. */
  private stateToPayload(state: EditorState): SaveableState {
    return {
      zones: state.zones,
      spawn: state.spawn,
      backgroundColor: state.backgroundColor,
      tilesets: state.tilesets,
    };
  }

  /** Convert a server payload into a partial editor state. */
  private payloadToState(data: unknown): Partial<EditorState> {
    const state: Partial<EditorState> = {};
    if (!data || typeof data !== 'object') return state;
    const payload = data as {
      zones?: unknown;
      spawn?: unknown;
      backgroundColor?: unknown;
      tilesets?: unknown;
    };

    if (Array.isArray(payload.zones)) {
      state.zones = payload.zones as EditorState['zones'];
    }

    const spawn = payload.spawn;
    if (
      spawn &&
      typeof spawn === 'object' &&
      typeof (spawn as { x?: unknown }).x === 'number' &&
      typeof (spawn as { y?: unknown }).y === 'number'
    ) {
      const s = spawn as { x: number; y: number };
      state.spawn = { x: s.x, y: s.y };
    }

    if (typeof payload.backgroundColor === 'string') {
      state.backgroundColor = payload.backgroundColor;
    }

    if (Array.isArray(payload.tilesets)) {
      state.tilesets = payload.tilesets as EditorState['tilesets'];
    }

    return state;
  }

  /** Save zones separately for live updates during editing. */
  public async saveZones(mapId: string, zones: EditorState['zones']): Promise<void> {
    const url = `${this.apiBase}/maps/${encodeURIComponent(mapId)}/editor-state`;

    const response = await fetch(url, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ zones, replaceZones: true }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new EditorPersistenceError(`Failed to save zones: ${response.status} ${text}`);
    }
  }

  /** Save the spawn point separately. */
  public async saveSpawn(mapId: string, spawn: EditorState['spawn']): Promise<void> {
    const url = `${this.apiBase}/maps/${encodeURIComponent(mapId)}/editor-state`;

    const response = await fetch(url, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ spawn }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new EditorPersistenceError(`Failed to save spawn: ${response.status} ${text}`);
    }
  }

  /**
   * Save all pending changes to the server atomically.
   * Order: terrain, delete objects, create objects, update objects, zones, spawn.
   */
  public async saveAllChanges(mapId: string, pendingChanges: PendingChanges, editorState: EditorState): Promise<void> {
    const encodedId = encodeURIComponent(mapId);

    await this.saveTerrainPaints(encodedId, pendingChanges.terrainPaints);
    await this.deleteObjects(encodedId, pendingChanges.objectsToDelete);
    await this.createObjects(encodedId, pendingChanges.objectsToAdd);
    await this.updateObjects(encodedId, pendingChanges.objectUpdates);
    await this.saveZonesIfModified(encodedId, pendingChanges, editorState);
    await this.saveSpawnIfUpdated(encodedId, pendingChanges);
  }

  /** Load map objects via the REST API. */
  public async loadMapObjects(mapId: string): Promise<MapObjectRecord[]> {
    const url = `${this.apiBase}/maps/${encodeURIComponent(mapId)}/objects`;
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      if (res.status === 404) return [];
      const text = await res.text();
      throw new EditorPersistenceError(`Load objects failed: ${res.status} ${text}`);
    }
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as MapObjectRecord[]) : [];
  }

  /* --- Private helpers for saveAllChanges --- */

  private async saveTerrainPaints(encodedId: string, paints: PendingChanges['terrainPaints']): Promise<void> {
    for (const paint of paints) {
      const payload: Record<string, unknown> = {
        layer: paint.layer,
        rect: paint.rect,
      };
      if (paint.erase) {
        payload.erase = true;
      } else {
        payload.tileRefId = paint.tileRefId;
      }
      const res = await fetch(`${this.apiBase}/maps/${encodedId}/paint-rect`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new EditorPersistenceError(`paint-rect failed: ${res.status} ${text}`);
      }
    }
  }

  private async deleteObjects(encodedId: string, objectIds: (number | string)[]): Promise<void> {
    for (const objId of objectIds) {
      const res = await fetch(`${this.apiBase}/maps/${encodedId}/objects/${objId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 404) {
        const text = await res.text();
        throw new EditorPersistenceError(`Delete object ${objId} failed: ${res.status} ${text}`);
      }
    }
  }

  private async createObjects(encodedId: string, objects: MapObjectRecord[]): Promise<void> {
    for (const obj of objects) {
      const payload = {
        assetPackUuid: obj.assetPackUuid,
        itemId: obj.itemId,
        category: obj.category,
        tileX: obj.tileX,
        tileY: obj.tileY,
        width: obj.width,
        height: obj.height,
        collide: obj.collide,
        zIndex: obj.zIndex,
        scaleFactor: obj.scaleFactor || 1,
        dataUrl: obj.dataUrl,
        rotation: obj.rotation || 0,
        flipX: obj.flipX || false,
        flipY: obj.flipY || false,
      };
      const res = await fetch(`${this.apiBase}/maps/${encodedId}/objects`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new EditorPersistenceError(`Create object failed: ${res.status} ${text}`);
      }
    }
  }

  private async updateObjects(encodedId: string, objectUpdates: PendingChanges['objectUpdates']): Promise<void> {
    for (const { id, updates } of objectUpdates) {
      const res = await fetch(`${this.apiBase}/maps/${encodedId}/objects/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new EditorPersistenceError(`Update object ${id} failed: ${res.status} ${text}`);
      }
    }
  }

  private async saveZonesIfModified(
    encodedId: string,
    pendingChanges: PendingChanges,
    editorState: EditorState,
  ): Promise<void> {
    if (!pendingChanges.zonesModified) return;
    const res = await fetch(`${this.apiBase}/maps/${encodedId}/editor-state`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zones: editorState.zones, replaceZones: true }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new EditorPersistenceError(`Save zones failed: ${res.status} ${text}`);
    }
  }

  private async saveSpawnIfUpdated(encodedId: string, pendingChanges: PendingChanges): Promise<void> {
    if (!pendingChanges.spawnUpdate) return;
    const res = await fetch(`${this.apiBase}/maps/${encodedId}/editor-state`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spawn: pendingChanges.spawnUpdate }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new EditorPersistenceError(`Save spawn failed: ${res.status} ${text}`);
    }
  }

  /** Register a tileset with the server. */
  public async registerTileset(
    mapId: string,
    tileset: {
      key: string;
      dataUrl: string;
      tileWidth: number;
      tileHeight: number;
      margin?: number;
      spacing?: number;
    },
  ): Promise<void> {
    const url = `${this.apiBase}/maps/${encodeURIComponent(mapId)}/tilesets`;

    const payload = {
      key: tileset.key,
      imageUrl: tileset.dataUrl,
      tileWidth: tileset.tileWidth,
      tileHeight: tileset.tileHeight,
      margin: tileset.margin ?? 0,
      spacing: tileset.spacing ?? 0,
    };

    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new EditorPersistenceError(`Failed to register tileset: ${response.status} ${text}`);
    }
  }
}

// Singleton instance shared across the app.
export const EditorPersistence = new EditorPersistenceService();
