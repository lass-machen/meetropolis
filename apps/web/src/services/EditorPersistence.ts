/**
 * EditorPersistence - Persistence-Schicht für Editor-State
 * 
 * Prinzipien:
 * - Atomic Operations (alles oder nichts)
 * - Explizite Error-Propagation
 * - Keine try-catch außer an Boundary
 * - Klare Interfaces
 */

import { EditorState } from './EditorService';

export class EditorPersistenceError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'EditorPersistenceError';
  }
}

type SaveableState = {
  zones: EditorState['zones'];
  assets: EditorState['assets'];
  spawn: EditorState['spawn'];
  backgroundColor: EditorState['backgroundColor'];
  tilesets: EditorState['tilesets'];
};

export class EditorPersistenceService {
  private apiBase: string;

  constructor(apiBase?: string) {
    this.apiBase =
      apiBase ||
      (window as any).VITE_API_BASE ||
      (import.meta as any).env?.VITE_API_BASE ||
      `${window.location.protocol}//${window.location.hostname}:2567`;
  }

  /**
   * Speichert Editor-State zum Server
   * 
   * @throws EditorPersistenceError bei Fehlern
   */
  public async save(mapName: string, state: EditorState): Promise<void> {
    const payload = this.stateToPayload(state);

    const url = `${this.apiBase}/maps/${encodeURIComponent(mapName)}/editor-state`;

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
      throw new EditorPersistenceError(
        `Server returned ${response.status}: ${text}`,
      );
    }

    // Erfolg - Server gibt eventuell aktualisierte Daten zurück
    const result = await response.json();
    return result;
  }

  /**
   * Lädt Editor-State vom Server
   * 
   * @throws EditorPersistenceError bei Fehlern
   */
  public async load(mapName: string): Promise<Partial<EditorState>> {
    const url = `${this.apiBase}/maps/${encodeURIComponent(mapName)}/editor-state`;

    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Keine gespeicherten Daten - das ist OK
        return {};
      }

      const text = await response.text();
      throw new EditorPersistenceError(
        `Server returned ${response.status}: ${text}`,
      );
    }

    const data = await response.json();
    return this.payloadToState(data);
  }

  /**
   * Konvertiert State zu Server-Payload
   */
  private stateToPayload(state: EditorState): SaveableState {
    return {
      zones: state.zones,
      assets: state.assets,
      spawn: state.spawn,
      backgroundColor: state.backgroundColor,
      tilesets: state.tilesets,
    };
  }

  /**
   * Konvertiert Server-Payload zu State
   */
  private payloadToState(data: any): Partial<EditorState> {
    const state: Partial<EditorState> = {};

    if (Array.isArray(data.zones)) {
      state.zones = data.zones;
    }

    if (Array.isArray(data.assets)) {
      state.assets = data.assets;
    }

    if (data.spawn && typeof data.spawn.x === 'number' && typeof data.spawn.y === 'number') {
      state.spawn = { x: data.spawn.x, y: data.spawn.y };
    }

    if (typeof data.backgroundColor === 'string') {
      state.backgroundColor = data.backgroundColor;
    }

    if (Array.isArray(data.tilesets)) {
      state.tilesets = data.tilesets;
    }

    return state;
  }

  /**
   * Speichert Zones separat (für Live-Updates während Bearbeitung)
   */
  public async saveZones(mapName: string, zones: EditorState['zones']): Promise<void> {
    const url = `${this.apiBase}/maps/${encodeURIComponent(mapName)}/editor-state`;

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
      throw new EditorPersistenceError(
        `Failed to save zones: ${response.status} ${text}`,
      );
    }
  }

  /**
   * Speichert Assets separat
   */
  public async saveAssets(mapName: string, assets: EditorState['assets']): Promise<void> {
    const url = `${this.apiBase}/maps/${encodeURIComponent(mapName)}/editor-state`;

    const response = await fetch(url, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ assets }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new EditorPersistenceError(
        `Failed to save assets: ${response.status} ${text}`,
      );
    }
  }

  /**
   * Speichert Spawn separat
   */
  public async saveSpawn(mapName: string, spawn: EditorState['spawn']): Promise<void> {
    const url = `${this.apiBase}/maps/${encodeURIComponent(mapName)}/editor-state`;

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
      throw new EditorPersistenceError(
        `Failed to save spawn: ${response.status} ${text}`,
      );
    }
  }

  /**
   * Registriert ein Tileset auf dem Server
   */
  public async registerTileset(
    mapName: string,
    tileset: {
      key: string;
      dataUrl: string;
      tileWidth: number;
      tileHeight: number;
      margin?: number;
      spacing?: number;
    }
  ): Promise<void> {
    const url = `${this.apiBase}/maps/${encodeURIComponent(mapName)}/tilesets`;

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
      throw new EditorPersistenceError(
        `Failed to register tileset: ${response.status} ${text}`,
      );
    }
  }
}

// Singleton-Instanz
export const EditorPersistence = new EditorPersistenceService();

