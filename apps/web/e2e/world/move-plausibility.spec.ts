import { decode } from '@colyseus/schema';
import { Protocol } from '@colyseus/sdk';
import type { Page } from '@playwright/test';

import { expect, test, type TestStackEnv } from '../fixtures';
import { completeSeedOnboarding, getSeedTenant, waitForParticipant } from '../fixtures/helpers';

test.skip(process.env.E2E_RUN !== 'true', 'E2E_RUN=true required for the isolated test stack.');

type Point = { x: number; y: number };
type SceneProbe = {
  currentMapName: string;
  mapRef: { widthInPixels: number; heightInPixels: number };
  playerManager: {
    getHero(): Point & { body: { reset(x: number, y: number): void } };
    getCurrentDirection(): string;
  };
  remotePlayersManager: { getAllRemotes(): Map<string, Point> };
};
type GameProbe = { scene: { getScene(key: string): SceneProbe | undefined } };
type Pose = Point & {
  sessionId: string;
  width: number;
  height: number;
  direction: string;
  mapName: string;
  remotes: Record<string, Point>;
};

function requireIsolatedStack(stack: TestStackEnv): void {
  if (!/^mtest-\d+$/.test(stack.project)) throw new Error('Expected an isolated mtest project.');
  for (const [address, port] of [
    [stack.apiUrl, process.env.MT_PORT_API],
    [stack.baseUrl, process.env.MT_PORT_WEB],
  ] as const) {
    const url = new URL(address);
    if (!port || url.protocol !== 'http:' || url.hostname !== 'localhost' || url.port !== port) {
      throw new Error('Expected an isolated localhost test port.');
    }
  }
}

function roomMessage(buffer: string | Buffer): string | undefined {
  if (typeof buffer === 'string' || buffer[0] !== Protocol.ROOM_DATA) return;
  const it = { offset: 1 };
  if (decode.stringCheck(buffer, it)) return decode.string(buffer, it);
}

async function routeMovement(page: Page, apiUrl: string) {
  const authority = new URL(apiUrl).host;
  const pending = new Set<ReturnType<typeof setTimeout>>();
  let lastDelivery = 0;
  let delaying = false;
  const counts = { moves: 0, delayed: 0, dropped: 0, corrections: 0 };

  await page.routeWebSocket(
    (url) => url.host === authority,
    (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        if (roomMessage(message) !== 'move') {
          server.send(message);
          return;
        }
        counts.moves++;
        if (!delaying) {
          server.send(message);
          return;
        }
        if (counts.moves % 7 === 0) {
          counts.dropped++;
          return;
        }
        const delay = counts.moves % 5 === 0 ? 260 : 140;
        // Preserve the order of frames on the reliable WebSocket.
        lastDelivery = Math.max(lastDelivery + 1, Date.now() + delay);
        const timer = setTimeout(() => {
          pending.delete(timer);
          server.send(message);
        }, lastDelivery - Date.now());
        counts.delayed++;
        pending.add(timer);
      });
      server.onMessage((message) => {
        if (roomMessage(message) === 'move_correction') counts.corrections++;
        socket.send(message);
      });
    },
  );

  return {
    counts,
    enableDelay: () => {
      delaying = true;
    },
    disableDelay: async () => {
      await expect.poll(() => pending.size).toBe(0);
      delaying = false;
    },
    dispose: () => pending.forEach((timer) => clearTimeout(timer)),
  };
}

async function readPose(page: Page): Promise<Pose | null> {
  return page.evaluate(() => {
    const game = window.__PHASER_GAME__ as GameProbe | undefined;
    const scene = game?.scene.getScene('Main');
    const hero = scene?.playerManager?.getHero();
    const sessionId = window.__localSessionId;
    if (!hero || !scene?.mapRef || !sessionId) return null;
    const remotes = scene.remotePlayersManager.getAllRemotes();
    return {
      sessionId,
      x: hero.x,
      y: hero.y,
      width: scene.mapRef.widthInPixels,
      height: scene.mapRef.heightInPixels,
      mapName: scene.currentMapName,
      direction: scene.playerManager.getCurrentDirection(),
      remotes: Object.fromEntries([...remotes].map(([id, { x, y }]) => [id, { x, y }])),
    };
  });
}

async function requirePose(page: Page): Promise<Pose> {
  await expect.poll(() => readPose(page), { timeout: 30_000 }).not.toBeNull();
  const pose = await readPose(page);
  if (!pose) throw new Error('Main scene is missing its hero.');
  return pose;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

async function walkWithDelay(page: Page): Promise<void> {
  await page.bringToFront();
  for (const [key, axis, sign] of [
    ['ArrowRight', 'x', 1],
    ['ArrowDown', 'y', 1],
    ['ArrowLeft', 'x', -1],
    ['ArrowUp', 'y', -1],
  ] as const) {
    const origin = await requirePose(page);
    let peak = sign * origin[axis];
    await page.keyboard.down(key);
    try {
      for (let i = 0; i < 20; i++) {
        const pose = await readPose(page);
        if (!pose) throw new Error('Main scene disappeared during walking.');
        const progress = sign * pose[axis];
        expect(progress).toBeGreaterThanOrEqual(peak - 2);
        peak = Math.max(peak, progress);
        if (peak - sign * origin[axis] >= 28) return;
        // Sample more than once per server movement interval.
        await new Promise<void>((resolve) => setTimeout(resolve, 35));
      }
    } finally {
      await page.keyboard.up(key);
    }
  }
  throw new Error('The hero could not walk 28 pixels from the test spawn.');
}

test('normal walking survives delayed moves and a jump never reaches the peer', async ({ stack, seed, loginAs }) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack);
  const { owner, admin } = getSeedTenant(seed).users;
  if (!owner || !admin) throw new Error('Expected seeded owner and admin.');
  await completeSeedOnboarding(stack.apiUrl, seed);
  const { page: actor } = await loginAs(owner);
  const { page: peer } = await loginAs(admin);
  const network = await routeMovement(actor, stack.apiUrl);
  await actor.reload();
  await waitForParticipant(actor, admin);
  await waitForParticipant(peer, owner);
  const origin = await requirePose(actor);

  try {
    network.enableDelay();
    await walkWithDelay(actor);
    await network.disableDelay();
    expect(network.counts.delayed).toBeGreaterThan(0);
    expect(network.counts.dropped).toBeGreaterThan(0);
    expect(network.counts.corrections).toBe(0);

    const before = await requirePose(actor);
    await expect
      .poll(async () => {
        const remote = (await readPose(peer))?.remotes[before.sessionId];
        return remote && distance(remote, before);
      })
      .toBeLessThan(16);
    const target = {
      x: before.x < before.width / 2 ? before.width - 32 : 32,
      y: before.y < before.height / 2 ? before.height - 32 : 32,
    };
    expect(distance(before, target)).toBeGreaterThan(150);

    const sentBefore = network.counts.moves;
    // Set the local pose once so the next real Phaser update sends a move for this point.
    await actor.evaluate(({ x, y }) => {
      const game = window.__PHASER_GAME__ as GameProbe | undefined;
      const scene = game?.scene.getScene('Main');
      if (!scene) throw new Error('Main scene disappeared before the jump.');
      scene.playerManager.getHero().body.reset(x, y);
    }, target);

    await expect.poll(() => network.counts.moves).toBeGreaterThan(sentBefore);
    await expect.poll(() => network.counts.corrections).toBeGreaterThan(0);
    await expect.poll(async () => distance(await requirePose(actor), before)).toBeLessThan(16);
    const remote = (await requirePose(peer)).remotes[before.sessionId];
    expect(remote && distance(remote, before)).toBeLessThan(16);
    expect(remote && distance(remote, target)).toBeGreaterThan(100);
  } finally {
    network.dispose();
    const response = await actor.request.post(`${stack.apiUrl}/auth/position`, {
      data: { x: Math.round(origin.x), y: Math.round(origin.y), direction: origin.direction, mapName: origin.mapName },
    });
    expect(response.ok()).toBe(true);
  }
});
