import * as Colyseus from 'colyseus.js';

export async function spawnColyseusBot(opts: { apiBase: string; identity: string }) {
  const client = new Colyseus.Client(opts.apiBase.replace('http', 'ws'));
  const room = await client.joinOrCreate('world', { identity: opts.identity, name: opts.identity });
  // Simple movement loop
  let alive = true;
  let t = 0;
  (async () => {
    while (alive) {
      t += 0.25;
      const x = 100 + Math.round(Math.sin(t) * 50);
      const y = 100 + Math.round(Math.cos(t) * 50);
      try { room.send('move', { x, y, direction: 'down' }); } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
  })();
  return {
    async stop() {
      alive = false;
      try { await room.leave(); } catch {}
    }
  };
}


