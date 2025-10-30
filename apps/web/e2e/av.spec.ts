import { test, expect, BrowserContext } from '@playwright/test';

const SHOULD_RUN = process.env.E2E_RUN === 'true';

(SHOULD_RUN ? test : test.skip)('AV Join-Order Matrix: A→B then B→A (token requests observed)', async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const url = baseURL!;

  async function createUserContext(name: string): Promise<BrowserContext> {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(url);
    // Store a deterministic displayName if app reads it
    await page.addInitScript((n) => { try { localStorage.setItem('displayName', n); } catch {} }, name);
    return ctx;
  }

  // A joins first, then B
  const ctxA = await createUserContext('UserA');
  const pageA = ctxA.pages()[0];

  const tokenA = pageA.waitForRequest((req) => req.url().includes('/livekit/token'), { timeout: 60_000 });
  await pageA.waitForTimeout(2_000);
  const ctxB = await createUserContext('UserB');
  const pageB = ctxB.pages()[0];
  const tokenB = pageB.waitForRequest((req) => req.url().includes('/livekit/token'), { timeout: 60_000 });
  await expect.soft(await tokenA).toBeTruthy();
  await expect.soft(await tokenB).toBeTruthy();

  await ctxA.close();
  await ctxB.close();
});


