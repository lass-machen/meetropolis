import crypto from 'crypto';
import { fileURLToPath } from 'url';
import type { Page } from '@playwright/test';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { test, expect } from '../fixtures';
import { MeetropolisApi, createApiRequest } from '../support/api';

/**
 * AV calls against the REAL LiveKit of the test stack.
 *
 * The call is joined by a bare LiveKit client in the browser, not by the app:
 * the app may leave the call on its own once the world disconnects it, but a
 * client that does not cooperate keeps its LiveKit connection. Only the server
 * removing the participant ends that call.
 */

const LIVEKIT_UMD = fileURLToPath(
  new URL('../../../../node_modules/livekit-client/dist/livekit-client.umd.js', import.meta.url),
);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} fehlt: scripts/teststack.sh up`);
  return value;
}

function roomService(): RoomServiceClient {
  const url = requiredEnv('LIVEKIT_URL').replace(/^ws(s?):\/\//, 'http$1://');
  return new RoomServiceClient(url, requiredEnv('LIVEKIT_API_KEY'), requiredEnv('LIVEKIT_API_SECRET'));
}

async function participantIdentities(service: RoomServiceClient, roomName: string): Promise<string[]> {
  const rooms = await service.listRooms([roomName]);
  if (rooms.length === 0) return [];
  return (await service.listParticipants(roomName)).map((p) => p.identity);
}

/**
 * Join `token`'s room with a bare livekit-client in `page`; resolves once connected.
 *
 * The page must be a document the web server really served: Chromium's local
 * network access checks block the LiveKit WebSocket from a document fulfilled
 * by `page.route` (net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS). The page
 * belongs to a fresh context without a session, so the app stays on its login
 * screen and does not join a call itself. Returns the URLs of every WebSocket
 * the page opens, so a test can show that only the bare client was connected.
 */
async function joinCall(page: Page, token: string, livekitUrl: string): Promise<string[]> {
  const base = requiredEnv('E2E_BASE_URL').replace(/\/+$/, '');
  const sockets: string[] = [];
  page.on('websocket', (socket) => sockets.push(socket.url()));
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ path: LIVEKIT_UMD });
  await page.evaluate(
    async ({ url, token: jwt }) => {
      const lk = (window as unknown as { LivekitClient: typeof import('livekit-client') }).LivekitClient;
      const room = new lk.Room();
      const state = { reconnected: 0, disconnectReason: null as number | null };
      room.on(lk.RoomEvent.Reconnected, () => {
        state.reconnected += 1;
      });
      room.on(lk.RoomEvent.Disconnected, (reason) => {
        state.disconnectReason = reason ?? null;
      });
      Object.assign(window, { __call: { room, state } });
      await room.connect(url, jwt);
    },
    { url: livekitUrl, token },
  );
  return sockets;
}

function callState(page: Page) {
  return page.evaluate(() => {
    const call = (window as unknown as { __call: { room: { state: string }; state: { reconnected: number } } }).__call;
    return { connection: call.room.state, reconnected: call.state.reconnected };
  });
}

test.describe('AV calls end with the tenant access', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'bare LiveKit client checked in chromium');

  test('removing a member puts them out of the tenant call at once', async ({ seed, stack, playwright, browser }) => {
    const tenant = seed.tenants.acme ?? seed.tenants.default ?? Object.values(seed.tenants)[0];
    const owner = tenant?.users.owner;
    if (!tenant || !owner) throw new Error('Seed-Mandant mit Owner fehlt.');

    const ownerRequest = await createApiRequest(playwright.request, stack.apiUrl, tenant.slug);
    const ownerApi = new MeetropolisApi(ownerRequest, stack.apiUrl, tenant.slug);
    await ownerApi.login(owner.email, owner.password);

    const email = `call-revoke-${crypto.randomUUID()}@example.test`;
    const password = 'Qacc-E2E-Password-1';
    const { code } = await ownerApi.invite(email, 'member');
    const memberRequest = await createApiRequest(playwright.request, stack.apiUrl, tenant.slug);
    const memberApi = new MeetropolisApi(memberRequest, stack.apiUrl, tenant.slug);
    const member = await memberApi.registerWithInvite({ code, email, name: 'Test Member', password });

    const livekitUrlResponse = await memberRequest.get(`${stack.apiUrl}/livekit/url`);
    expect(livekitUrlResponse.status()).toBe(200);
    const livekitUrl = ((await livekitUrlResponse.json()) as { url: string }).url;

    const roomName = 'world';
    const tokenResponse = await memberRequest.post(`${stack.apiUrl}/livekit/token`, {
      data: { roomName, identity: member.id },
    });
    expect(tokenResponse.status()).toBe(200);

    const page = await browser.newPage();
    try {
      const sockets = await joinCall(page, await tokenResponse.text(), livekitUrl);
      const service = roomService();
      const livekitRoom = `${tenant.slug}:world`;
      await expect.poll(() => participantIdentities(service, livekitRoom), { timeout: 30_000 }).toContain(member.id);

      const removal = await ownerRequest.delete(`${stack.apiUrl}/users/${member.id}`);
      expect(removal.status()).toBe(200);

      await expect
        .poll(() => participantIdentities(service, livekitRoom), { timeout: 15_000 })
        .not.toContain(member.id);
      await expect.poll(async () => (await callState(page)).connection, { timeout: 15_000 }).toBe('disconnected');
      // No world connection on the page: the server ended the call, the app did not cooperate.
      expect(sockets.filter((url) => !url.startsWith(livekitUrl))).toEqual([]);
    } finally {
      await page.close();
      await ownerRequest.dispose();
      await memberRequest.dispose();
    }
  });

  test('a call reconnects after a network drop once its first token has expired', async ({
    browser,
    playwright,
    stack,
  }) => {
    // Measurement behind the token lifetime decision (apps/server/src/livekit.ts):
    // the LiveKit server hands connected participants refreshed tokens, so a
    // short lifetime must not break a call that loses its network later.
    const roomName = `ttl-${crypto.randomUUID().slice(0, 8)}`;
    const token = new AccessToken(requiredEnv('LIVEKIT_API_KEY'), requiredEnv('LIVEKIT_API_SECRET'), {
      identity: `ttl-probe-${crypto.randomUUID().slice(0, 8)}`,
      ttl: 20,
    });
    token.addGrant({ room: roomName, roomJoin: true, canPublish: false, canSubscribe: true });

    const anonymous = await playwright.request.newContext();
    const livekitUrlResponse = await anonymous.get(`${stack.apiUrl}/livekit/url`);
    expect(livekitUrlResponse.status()).toBe(200);
    const livekitUrl = ((await livekitUrlResponse.json()) as { url: string }).url;
    await anonymous.dispose();

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await joinCall(page, await token.toJwt(), livekitUrl);
      await page.waitForTimeout(35_000);
      await context.setOffline(true);
      await page.waitForTimeout(5_000);
      await context.setOffline(false);
      await expect
        .poll(async () => callState(page), { timeout: 60_000 })
        .toEqual({
          connection: 'connected',
          reconnected: 1,
        });
    } finally {
      await context.close();
    }
  });
});
