/**
 * Two-client coverage for switching maps inside the same world room.
 *
 * A second map is created on the seed tenant through POST /admin/maps/:id/copy
 * (MeetropolisApi.copyAdminMap) before either client joins, so GET /maps on
 * boot already returns two maps and the MapSwitcher select is shown. The copy
 * is removed afterwards through DELETE /admin/maps/:id.
 *
 * Selectors taken from the product:
 * - MapSwitcher native select with title "Map wechseln"
 *   (apps/web/src/ui/hud/MapSwitcher.tsx).
 * - Same-map participant tile: ParticipantsGrid wraps each UiParticipant in a
 *   role="button" whose name is the CompactCard display name (uc-container).
 *   That list is rebuilt from remotesRef, which drops the peer on map change.
 */
import { randomUUID } from 'node:crypto';

import type { APIRequest, Page } from '@playwright/test';

import { expect, test } from '../fixtures';
import { getSeedTenant, waitForParticipant } from '../fixtures/helpers';
import type { TestStackEnv } from '../fixtures/types';
import { createApiRequest, MeetropolisApi } from '../support/api';

const SHOULD_RUN = process.env.E2E_RUN === 'true';

test.skip(!SHOULD_RUN, 'E2E_RUN=true required: this spec only runs against the isolated test stack.');

const UI_TIMEOUT_MS = 30_000;
const JOIN_TIMEOUT_MS = 60_000;

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mapSwitcher(page: Page) {
  return page.getByTitle('Map wechseln');
}

function sameMapParticipantTile(page: Page, displayName: string) {
  return page.locator('.uc-container').getByRole('button', { name: new RegExp(escapedRegex(displayName), 'i') });
}

async function otherMapId(page: Page, currentMapId: string): Promise<string> {
  const values = await mapSwitcher(page)
    .locator('option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const next = values.find((value) => value !== currentMapId);
  if (!next) throw new Error('Map switcher has no second map option.');
  return next;
}

async function withOperatorApi<T>(
  playwrightRequest: APIRequest,
  stack: Pick<TestStackEnv, 'apiUrl' | 'operatorEmail' | 'operatorPassword'>,
  body: (api: MeetropolisApi, request: Awaited<ReturnType<typeof createApiRequest>>) => Promise<T>,
): Promise<T> {
  const operatorRequest = await createApiRequest(playwrightRequest, stack.apiUrl, 'default');
  try {
    const operatorApi = new MeetropolisApi(operatorRequest, stack.apiUrl, 'default');
    await operatorApi.login(stack.operatorEmail, stack.operatorPassword);
    return await body(operatorApi, operatorRequest);
  } finally {
    await operatorRequest.dispose();
  }
}

async function copySecondTenantMap(
  playwrightRequest: APIRequest,
  stack: Pick<TestStackEnv, 'apiUrl' | 'operatorEmail' | 'operatorPassword'>,
  tenant: { tenantId: string; mapId: string },
  mapName: string,
): Promise<string> {
  return withOperatorApi(playwrightRequest, stack, async (operatorApi) => {
    await operatorApi.copyAdminMap(tenant.mapId, tenant.tenantId, mapName);
    const maps = await operatorApi.adminMaps();
    const copied = maps.find((map) => map.tenantId === tenant.tenantId && map.name === mapName);
    if (!copied) throw new Error(`Copied map ${mapName} did not appear in GET /admin/maps.`);
    return copied.id;
  });
}

async function deleteCopiedTenantMap(
  playwrightRequest: APIRequest,
  stack: Pick<TestStackEnv, 'apiUrl' | 'operatorEmail' | 'operatorPassword'>,
  mapId: string,
): Promise<void> {
  await withOperatorApi(playwrightRequest, stack, async (_api, operatorRequest) => {
    const response = await operatorRequest.delete(`/admin/maps/${encodeURIComponent(mapId)}`);
    if (!response.ok()) {
      throw new Error(`DELETE /admin/maps/${mapId} failed: HTTP ${response.status()} ${await response.text()}`);
    }
  });
}

test('two clients follow each other across maps', async ({ roomUsers, playwright, seed, stack }) => {
  test.setTimeout(180_000);
  const tenant = getSeedTenant(seed);
  const copiedMapId = await copySecondTenantMap(
    playwright.request,
    stack,
    tenant,
    `Second floor ${randomUUID().slice(0, 8)}`,
  );
  try {
    const [clientA, clientB] = await roomUsers(2, { tenant: 'seed' });
    if (!clientA || !clientB) throw new Error('roomUsers did not return two users.');

    const switcherA = mapSwitcher(clientA.page);
    const switcherB = mapSwitcher(clientB.page);
    await expect(switcherA).toBeVisible({ timeout: JOIN_TIMEOUT_MS });
    await expect(switcherB).toBeVisible({ timeout: JOIN_TIMEOUT_MS });
    await expect.poll(() => switcherA.locator('option').count(), { timeout: UI_TIMEOUT_MS }).toBeGreaterThan(1);

    const startMapId = await switcherA.inputValue();
    await expect(switcherB).toHaveValue(startMapId, { timeout: UI_TIMEOUT_MS });
    const targetMapId = await otherMapId(clientA.page, startMapId);

    await waitForParticipant(clientA.page, clientB.user);
    await waitForParticipant(clientB.page, clientA.user);
    await expect(sameMapParticipantTile(clientA.page, clientB.user.displayName)).toBeVisible({
      timeout: JOIN_TIMEOUT_MS,
    });
    await expect(sameMapParticipantTile(clientB.page, clientA.user.displayName)).toBeVisible({
      timeout: JOIN_TIMEOUT_MS,
    });

    await switcherA.selectOption(targetMapId);
    await expect(switcherA).toHaveValue(targetMapId, { timeout: UI_TIMEOUT_MS });
    await expect(sameMapParticipantTile(clientB.page, clientA.user.displayName)).toBeHidden({
      timeout: UI_TIMEOUT_MS,
    });

    await switcherB.selectOption(targetMapId);
    await expect(switcherB).toHaveValue(targetMapId, { timeout: UI_TIMEOUT_MS });
    await expect(sameMapParticipantTile(clientA.page, clientB.user.displayName)).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    });
    await expect(sameMapParticipantTile(clientB.page, clientA.user.displayName)).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    });
    await waitForParticipant(clientA.page, clientB.user);
    await waitForParticipant(clientB.page, clientA.user);
  } finally {
    await deleteCopiedTenantMap(playwright.request, stack, copiedMapId);
  }
});
