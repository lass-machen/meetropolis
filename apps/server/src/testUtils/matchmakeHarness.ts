/**
 * Test harness: a REAL Colyseus server (WebSocketTransport on a real HTTP
 * server, the real WorldRoom) wired the way index.ts wires it. An Express app
 * is the HTTP server's request listener, Colyseus takes it out of the path for
 * its own route, and the matchmake guard is installed after listen().
 *
 * The caller replaces the database: the test file must
 * `vi.mock('../db.js')` (relative to itself) with a counting
 * `createPrismaClient`, which is how tests prove that a refused request builds
 * neither a room nor a PrismaClient (each room builds exactly one).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Server as ColyseusServer, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { WorldRoom } from '../rooms/WorldRoom.js';
import { installMatchmakeGuard } from '../matchmake/guard.js';
import { installPartitionKeyValidation, type TenantExists } from '../matchmake/tenantPartition.js';

/** The slice of PrismaClient a freshly created, unauthenticated room touches. */
export function makeFakePrisma() {
  return {
    tenant: { findUnique: () => Promise.resolve(null) },
    map: { findFirst: () => Promise.resolve(null) },
    session: { findFirst: () => Promise.resolve(null) },
    $disconnect: () => Promise.resolve(),
  };
}

export interface MatchmakeTestServer {
  base: string;
  httpServer: http.Server;
  gameServer: ColyseusServer;
  /** Puts the unwrapped `invokeMethod` back; called by {@link stopMatchmakeServer}. */
  uninstallValidation: () => void;
}

export interface StartOptions {
  /** Express `trust proxy` setting, as in production (TRUST_PROXY). */
  trustProxy?: boolean | number;
  /** Install the transport guard (body cap, rate limit). Default true. */
  guard?: boolean;
  /** Tenant lookup behind the existence check. Default: every slug exists. */
  tenantExists?: TenantExists;
  /**
   * Leave loopback callers out of the rate limit, as production does. Off by
   * default: the harness' own clients connect over loopback, so tests that
   * exercise the limit model external callers.
   */
  loopbackExempt?: boolean;
}

export async function startMatchmakeServer(options: StartOptions = {}): Promise<MatchmakeTestServer> {
  const trustProxy = options.trustProxy ?? false;
  const app = express();
  app.set('trust proxy', trustProxy);
  app.get('/', (_req, res) => {
    res.send('ok');
  });
  const httpServer = http.createServer(app);
  const gameServer = new ColyseusServer({
    transport: new WebSocketTransport({ server: httpServer }),
    gracefullyShutdown: false,
    greet: false,
  });
  gameServer.define('world', WorldRoom).filterBy(['tenant']);
  const uninstallValidation = installPartitionKeyValidation(options.tenantExists ?? (() => Promise.resolve(true)));
  await gameServer.listen(0, '127.0.0.1');
  if (options.guard !== false) {
    installMatchmakeGuard(httpServer, {
      trustProxy,
      ...(options.loopbackExempt ? {} : { isInProcessCaller: () => false }),
    });
  }
  const { port } = httpServer.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, httpServer, gameServer, uninstallValidation };
}

export async function stopMatchmakeServer(server: MatchmakeTestServer): Promise<void> {
  server.uninstallValidation();
  await server.gameServer.gracefullyShutdown(false);
  server.httpServer.closeAllConnections();
}

/** Dispose every room a previous test left behind (a seat reservation keeps one alive for 15 s). */
export async function disposeAllRooms(): Promise<void> {
  for (const listing of await matchMaker.query({})) {
    await matchMaker.remoteRoomCall(listing.roomId, 'disconnect');
  }
}

export interface MatchmakeResult {
  status: number;
  body: { code?: number; error?: string; roomId?: string };
  headers: Headers;
}

export async function matchmake(
  server: MatchmakeTestServer,
  body: string | Uint8Array | undefined,
  init: { method?: string; headers?: Record<string, string>; path?: string } = {},
): Promise<MatchmakeResult> {
  const res = await fetch(`${server.base}${init.path ?? '/matchmake/joinOrCreate/world'}`, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...init.headers },
    ...(body === undefined ? {} : { body }),
  });
  const text = await res.text();
  let parsed: MatchmakeResult['body'] = {};
  try {
    parsed = JSON.parse(text) as MatchmakeResult['body'];
  } catch {
    // Not JSON: leave the body empty, the status carries the assertion.
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

/** POST with a hand-built request, for bodies `fetch` would normalise away. */
export function rawPost(
  server: MatchmakeTestServer,
  headers: Record<string, string>,
  write: (req: http.ClientRequest) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${server.base}/matchmake/joinOrCreate/world`);
    const req = http.request(
      { host: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    write(req);
  });
}

export async function worldRooms(): Promise<Array<{ roomId: string; metadata?: { tenant?: unknown } }>> {
  return matchMaker.query({ name: 'world' });
}
