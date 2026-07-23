import { spawnColyseusBot } from './workers/colyseusBot.js';
// The LiveKit bot is imported dynamically so the dependency stays optional.

export async function runScenario(opts: {
  mode: 'node' | 'browser';
  users: number;
  rampPerSec: number;
  apiBase: string;
  livekitUrl: string;
  room: string;
  durationSec: number;
}) {
  const bots: Array<{ stop: () => Promise<void> }> = [];
  const startAt = Date.now();
  const skipLivekit = process.env.SKIP_LIVEKIT === 'true';
  for (let i = 0; i < opts.users; i++) {
    const identity = `bot-${String(i + 1).padStart(3, '0')}`;
    // Ramp-up
    if (i > 0 && opts.rampPerSec > 0) {
      const delayMs = Math.floor(1000 * (i / opts.rampPerSec));
      await new Promise((r) => setTimeout(r, delayMs));
    }
    // Start Colyseus bot
    bots.push(await spawnColyseusBot({ apiBase: opts.apiBase, identity }));
    // Start LiveKit bot
    if (!skipLivekit) {
      try {
        const mod: typeof import('./workers/livekitBot.js') = await import('./workers/livekitBot.js');
        bots.push(
          await mod.spawnLivekitBot({
            livekitUrl: opts.livekitUrl,
            apiBase: opts.apiBase,
            roomName: opts.room,
            identity,
          }),
        );
      } catch {
        // LiveKit is optional: when the import fails, keep running Colyseus-only.
      }
    }
  }
  // Run for duration
  const until = startAt + opts.durationSec * 1000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  // Stop all
  for (const b of bots) {
    try {
      await b.stop();
    } catch {}
  }
}
