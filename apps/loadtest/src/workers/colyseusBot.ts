import { Client } from '@colyseus/sdk';
import { ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import {
  apiHttpBase,
  apiWsBase,
  authHeaders,
  loginBot,
  readResponseJson,
  redactSecrets,
  type LoginOptions,
} from './session.js';

type Point = { x: number; y: number };
type Zone = { polygon?: Point[] };
type MapEntry = { name?: string; zones?: Zone[] };

const FALLBACK_WAYPOINTS: Point[] = [
  { x: 80, y: 80 },
  { x: 160, y: 80 },
  { x: 160, y: 160 },
  { x: 80, y: 160 },
];

export type ColyseusBot = {
  userId: string;
  sessionId: string;
  token: string;
  stop: () => Promise<void>;
};

export async function spawnColyseusBot(opts: LoginOptions): Promise<ColyseusBot> {
  const session = await loginBot(opts);
  const client = new Client(apiWsBase(opts.apiBase));
  client.auth.token = session.token;
  const room = await joinWorld(client, opts.tenant);
  const waypoints = await loadWaypoints(opts.apiBase, opts.tenant, session.token);
  const alive = { value: true };
  startPatrol(room, waypoints, alive);
  return {
    userId: session.userId,
    sessionId: room.sessionId,
    token: session.token,
    async stop() {
      alive.value = false;
      try {
        await room.leave();
      } catch {
        // The room may already be gone.
      }
    },
  };
}

function centroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const point of points) {
    sx += point.x;
    sy += point.y;
  }
  return { x: Math.round(sx / points.length), y: Math.round(sy / points.length) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function joinWorld(client: Client, tenant: string) {
  let attempt = 0;
  while (attempt < 6) {
    try {
      return await client.joinOrCreate('world', {
        tenant,
        zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
      });
    } catch (error: unknown) {
      attempt += 1;
      if (attempt >= 6) throw new Error(joinFailure(error));
      await sleep(Math.min(5000, 200 * 2 ** (attempt - 1)));
    }
  }
  throw new Error('world join failed');
}

function joinFailure(error: unknown): string {
  const message = error instanceof Error ? redactSecrets(error.message) : '';
  if (!message) return 'world join failed';
  return `world join failed: ${message.slice(0, 180)}`;
}

async function loadWaypoints(apiBase: string, tenant: string, token: string): Promise<Point[]> {
  try {
    const response = await fetch(`${apiHttpBase(apiBase)}/maps`, {
      method: 'GET',
      headers: authHeaders(tenant, token),
    });
    if (!response.ok) return FALLBACK_WAYPOINTS;
    const centers = waypointsFromMaps(await readResponseJson(response));
    if (centers.length > 0) return centers;
  } catch {
    return FALLBACK_WAYPOINTS;
  }
  return FALLBACK_WAYPOINTS;
}

function waypointsFromMaps(raw: unknown): Point[] {
  if (!Array.isArray(raw)) return [];
  const maps = raw.filter(isMapEntry);
  const office = maps.find((map) => (map.name || '').toLowerCase() === 'office') || maps[0];
  const zones = office && Array.isArray(office.zones) ? office.zones : [];
  const centers: Point[] = [];
  for (const zone of zones) {
    if (Array.isArray(zone.polygon)) centers.push(centroid(zone.polygon));
  }
  return centers;
}

function isMapEntry(value: unknown): value is MapEntry {
  return typeof value === 'object' && value !== null;
}

function directionOf(dx: number, dy: number): 'up' | 'down' | 'left' | 'right' {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

type JoinedRoom = Awaited<ReturnType<typeof joinWorld>>;

function startPatrol(room: JoinedRoom, waypoints: Point[], alive: { value: boolean }): void {
  const route = [...waypoints].sort(() => Math.random() - 0.5);
  let index = 0;
  let pos = { x: route[0].x, y: route[0].y };
  const speed = 40;
  let lastTs = Date.now();
  void (async () => {
    sendMove(room, pos, 'down');
    while (alive.value) {
      const now = Date.now();
      const dt = Math.max(1, now - lastTs) / 1000;
      lastTs = now;
      const target = route[index % route.length];
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 3) {
        index += 1;
        await sleep(500 + Math.floor(Math.random() * 800));
        continue;
      }
      pos = stepToward(pos, dx, dy, dist, Math.min(dist, speed * dt));
      sendMove(room, pos, directionOf(dx, dy));
      await sleep(150);
    }
  })();
}

function stepToward(pos: Point, dx: number, dy: number, dist: number, step: number): Point {
  if (dist <= 0) return pos;
  return {
    x: Math.round(pos.x + (dx / dist) * step),
    y: Math.round(pos.y + (dy / dist) * step),
  };
}

function sendMove(room: JoinedRoom, pos: Point, direction: string): void {
  try {
    room.send('move', { x: pos.x, y: pos.y, direction });
  } catch {
    // A dropped move is retried on the next tick.
  }
}
