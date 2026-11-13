import { spawnColyseusBot } from './workers/colyseusBot.js';
import type { LoadtestAccount } from './workers/session.js';
import type { LivekitBotOptions } from './workers/livekitBot.js';

export async function runScenario(opts: {
  mode: 'node' | 'browser';
  users: number;
  rampPerSec: number;
  apiBase: string;
  room: string;
  durationSec: number;
  tenant: string;
  accounts: LoadtestAccount[];
}): Promise<void> {
  if (opts.accounts.length < opts.users) {
    throw new Error(`not enough loadtest accounts: have ${opts.accounts.length}, need ${opts.users}`);
  }
  const bots: Array<{ stop: () => Promise<void> }> = [];
  const startAt = Date.now();
  const skipLivekit = process.env.SKIP_LIVEKIT === 'true';
  for (let i = 0; i < opts.users; i++) {
    await rampDelay(i, opts.rampPerSec);
    const account = opts.accounts[i];
    if (!account) {
      throw new Error(`not enough loadtest accounts: have ${opts.accounts.length}, need ${opts.users}`);
    }
    const world = await spawnColyseusBot({
      apiBase: opts.apiBase,
      tenant: opts.tenant,
      email: account.email,
      password: account.password,
    });
    bots.push(world);
    if (!skipLivekit) {
      await startLivekitBot(bots, {
        apiBase: opts.apiBase,
        tenant: opts.tenant,
        token: world.token,
        roomName: opts.room,
      });
    }
  }
  await waitUntil(startAt + opts.durationSec * 1000);
  await stopAll(bots);
}

function rampDelay(index: number, rampPerSec: number): Promise<void> {
  if (index === 0 || rampPerSec <= 0) return Promise.resolve();
  const delayMs = Math.floor(1000 * (index / rampPerSec));
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function startLivekitBot(bots: Array<{ stop: () => Promise<void> }>, opts: LivekitBotOptions): Promise<void> {
  try {
    const mod: typeof import('./workers/livekitBot.js') = await import('./workers/livekitBot.js');
    bots.push(await mod.spawnLivekitBot(opts));
  } catch (error: unknown) {
    if (isMissingModule(error)) return;
    throw error;
  }
}

function isMissingModule(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND';
}

async function waitUntil(untilMs: number): Promise<void> {
  while (Date.now() < untilMs) {
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
  }
}

async function stopAll(bots: Array<{ stop: () => Promise<void> }>): Promise<void> {
  for (const bot of bots) {
    try {
      await bot.stop();
    } catch {
      // One bot failing to stop must not skip the others.
    }
  }
}
