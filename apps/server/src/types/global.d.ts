/**
 * Global type definitions for server-side code
 * Extends the global namespace with Colyseus/game server types
 *
 * This file is the ONLY place `gameServer` and `activeWorldRooms` may be
 * declared. A second `declare global` for the same name elsewhere is a TS2403
 * that `skipLibCheck: true` hides: the program then compiles against whichever
 * declaration it picked, and the other one silently describes nothing. That is
 * how `setDefaultSpawn` came to be declared here with a single argument while
 * the room has taken two since it was written.
 */

import type { WorldRoom } from '../rooms/WorldRoom.js';

export {};

declare global {
  var gameServer:
    | {
        presence?: {
          publish: (channel: string, data: unknown) => Promise<void>;
        };
        matchMaker?: {
          query: (params: Record<string, unknown>) => Promise<
            Array<{
              roomId: string;
              clients?: number;
              [key: string]: unknown;
            }>
          >;
        };
        rooms?: Map<string, unknown> | unknown[];
      }
    | undefined;

  /**
   * Every world room this process currently hosts, as registered by
   * `WorldRoom.onCreate` (see `rooms/WorldRoom.ts`). Typed against the real
   * class rather than a hand-written stand-in, so a rename or a changed
   * signature on the room breaks the consumers instead of leaving them reading
   * a field that no longer exists.
   *
   * Single-node only: the set is process-local, so a horizontally scaled
   * deployment sees only its own rooms here.
   */
  var activeWorldRooms: Set<WorldRoom> | undefined;
}
