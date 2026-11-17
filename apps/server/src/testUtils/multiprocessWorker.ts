/**
 * Child-process Colyseus worker for multi-process Redis tests.
 *
 * Started with `child_process.fork` and `execArgv: ['--import', 'tsx']`.
 * Reads PORT, REDIS_URL and DATABASE_URL from the environment, shares
 * presence and the room registry through Redis, and answers IPC commands
 * from the parent test.
 */
import { broadcastAccessRevoked, broadcastMapUpdate } from '../api/utils/broadcast.js';
import { installSessionInvalidationRelay } from '../api/utils/sessionInvalidationRelay.js';
import { createColyseusScalingOptions } from '../ops/colyseusScaling.js';
import { closeSharedRedis } from '../ops/redisConnection.js';
import { startMatchmakeServer, stopMatchmakeServer, type MatchmakeTestServer } from './matchmakeHarness.js';

interface WorkerEnv {
  port: number;
  redisUrl: string;
}

type ParentCommand =
  | { cmd: 'localRooms' }
  | { cmd: 'mapUpdate'; tenant: string; payload: unknown }
  | { cmd: 'revoke'; userId: string }
  | { cmd: 'stop' };

type ParentEvent =
  | { type: 'ready'; port: number }
  | { type: 'localRooms'; roomIds: string[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

function send(event: ParentEvent): void {
  process.send?.(event);
}

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  send({ type: 'error', message });
  process.exit(1);
}

function readWorkerEnv(): WorkerEnv {
  const redisUrl = process.env.REDIS_URL?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const port = Number(process.env.PORT);
  if (!redisUrl) throw new Error('REDIS_URL is required');
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!Number.isInteger(port) || port <= 0) throw new Error('PORT must be a positive integer');
  return { port, redisUrl };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as Record<string, unknown>;
}

function parseCommand(raw: unknown): ParentCommand | null {
  const record = asRecord(raw);
  if (!record) return null;
  if (record.cmd === 'localRooms') return { cmd: 'localRooms' };
  if (record.cmd === 'stop') return { cmd: 'stop' };
  if (record.cmd === 'mapUpdate' && typeof record.tenant === 'string') {
    return { cmd: 'mapUpdate', tenant: record.tenant, payload: record.payload };
  }
  if (record.cmd === 'revoke' && typeof record.userId === 'string') {
    return { cmd: 'revoke', userId: record.userId };
  }
  return null;
}

function localRoomIds(): string[] {
  return Array.from(global.activeWorldRooms ?? []).map((room) => room.roomId);
}

async function handleCommand(server: MatchmakeTestServer, raw: unknown): Promise<void> {
  const command = parseCommand(raw);
  if (!command) return;
  if (command.cmd === 'localRooms') {
    send({ type: 'localRooms', roomIds: localRoomIds() });
    return;
  }
  if (command.cmd === 'mapUpdate') {
    broadcastMapUpdate(command.tenant, 'objects_updated', command.payload);
    send({ type: 'done' });
    return;
  }
  if (command.cmd === 'revoke') {
    broadcastAccessRevoked(command.userId);
    send({ type: 'done' });
    return;
  }
  await stopMatchmakeServer(server);
  await closeSharedRedis();
  process.exit(0);
}

async function main(): Promise<void> {
  const env = readWorkerEnv();
  const scaling = createColyseusScalingOptions({
    REDIS_URL: env.redisUrl,
    COLYSEUS_PUBLIC_ADDRESS: `127.0.0.1:${env.port}`,
  });
  if (!scaling.presence) throw new Error('REDIS_URL is required');
  const server = await startMatchmakeServer({
    port: env.port,
    scaling,
    loopbackExempt: true,
  });
  (globalThis as unknown as { gameServer: unknown }).gameServer = server.gameServer;
  installSessionInvalidationRelay(scaling.presence);
  process.on('message', (raw: unknown) => {
    handleCommand(server, raw).catch(fail);
  });
  send({ type: 'ready', port: env.port });
}

main().catch(fail);
