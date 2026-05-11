import { Client } from '@colyseus/sdk';

type Zone = { id: string; name: string; polygon: Array<{ x: number; y: number }> };

function centroid(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (!points || points.length === 0) return { x: 0, y: 0 };
  let sx = 0,
    sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: Math.round(sx / points.length), y: Math.round(sy / points.length) };
}

export async function spawnColyseusBot(opts: { apiBase: string; identity: string }) {
  const toWs = (url: string) => url.replace(/^http(s?):\/\//, 'ws$1://');
  const toHttp = (url: string) => url.replace(/^ws(s?):\/\//, 'http$1://');
  const wsEndpoint = toWs(opts.apiBase);
  const httpEndpoint = toHttp(opts.apiBase);

  const client = new Client(wsEndpoint);

  // Retry matchmaking a few times to avoid transient "connection refused" during warmup
  async function joinWithRetry(maxAttempts: number, baseDelayMs: number) {
    let attempt = 0;

    while (true) {
      try {
        return await client.joinOrCreate('world', { identity: opts.identity, name: opts.identity });
      } catch (e: unknown) {
        attempt++;
        if (attempt >= maxAttempts) throw e;
        const delay = Math.min(5000, baseDelayMs * Math.pow(2, attempt - 1));
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  const room = await joinWithRetry(6, 200);

  // Lade Zonen und baue Wegpunkte (Zentroiden)
  let waypoints: Array<{ x: number; y: number }> = [];
  try {
    const mapsRes = await fetch(`${httpEndpoint}/maps`, { method: 'GET' });
    if (mapsRes.ok) {
      const maps = await mapsRes.json();
      const office = Array.isArray(maps)
        ? maps.find((m: any) => (m?.name || '').toLowerCase() === 'office') || maps[0]
        : null;
      const zones: Zone[] = Array.isArray(office?.zones) ? office.zones : [];
      const cs = zones
        .map((z) => (Array.isArray((z as any)?.polygon) ? centroid((z as any).polygon) : null))
        .filter((c): c is { x: number; y: number } => !!c);
      if (cs.length > 0) waypoints = cs;
    }
  } catch {}
  // Fallback Kreisbewegung, falls keine Zonen vorhanden
  if (waypoints.length === 0) {
    waypoints = [
      { x: 80, y: 80 },
      { x: 160, y: 80 },
      { x: 160, y: 160 },
      { x: 80, y: 160 },
    ];
  }

  // Randomise the order per bot.
  waypoints = [...waypoints].sort(() => Math.random() - 0.5);

  let alive = true;
  let idx = 0;
  let pos = { x: waypoints[0].x, y: waypoints[0].y };
  const speed = 40; // Pixels per second.
  let lastTs = Date.now();

  void (async () => {
    // Initial position.
    try {
      room.send('move', { x: pos.x, y: pos.y, direction: 'down' });
    } catch {}
    while (alive) {
      const now = Date.now();
      const dt = Math.max(1, now - lastTs) / 1000;
      lastTs = now;
      const target = waypoints[idx % waypoints.length];
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 3) {
        // Brief dwell time in the zone before moving to the next waypoint.
        idx++;
        await new Promise((r) => setTimeout(r, 500 + Math.floor(Math.random() * 800)));
        continue;
      }
      const step = Math.min(dist, speed * dt);
      if (dist > 0) {
        pos = { x: Math.round(pos.x + (dx / dist) * step), y: Math.round(pos.y + (dy / dist) * step) };
      }
      // Richtung approximieren
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      try {
        room.send('move', { x: pos.x, y: pos.y, direction: dir });
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
  })();

  return {
    async stop() {
      alive = false;
      try {
        await room.leave();
      } catch {}
    },
  };
}
