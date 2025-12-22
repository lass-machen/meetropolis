/**
 * Global type definitions for server-side code
 * Extends the global namespace with Colyseus/game server types
 */

export {};

declare global {
  var gameServer: {
    presence?: {
      publish: (channel: string, data: unknown) => Promise<void>;
    };
    matchMaker?: {
      query: (params: Record<string, unknown>) => Promise<Array<{
        roomId: string;
        clients?: number;
        [key: string]: unknown;
      }>>;
    };
    rooms?: Map<string, unknown> | unknown[];
  } | undefined;

  var activeWorldRooms: Set<{
    roomId?: string;
    roomName?: string;
    clients?: Set<unknown> | unknown[];
    locked?: boolean;
    maxClients?: number;
    metadata?: {
      tenant?: string;
      [key: string]: unknown;
    };
    state?: {
      players?: Map<string, {
        identity?: string;
        name?: string;
        x?: number;
        y?: number;
        dnd?: boolean;
        [key: string]: unknown;
      }>;
      [key: string]: unknown;
    };
    broadcast?: (event: string, data: unknown) => void;
    setDefaultSpawn?: (pos: { x: number; y: number }) => void;
    [key: string]: unknown;
  }> | undefined;
}
