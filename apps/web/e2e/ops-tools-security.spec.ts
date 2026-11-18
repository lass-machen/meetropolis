import { Buffer } from 'node:buffer';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

// Operator-tools security: HTML event attributes, map-name marker execution,
// Content-Security-Policy on /tools, and production 404s for atelier entries.
// Talks to the API server that mounts /tools (WEB_BASE_URL must be that origin).
// Credentials come from the environment; authentication uses the real API. No API route mocks.
//
// Runs only with E2E_RUN=true plus WEB_BASE_URL, TOOLS_USER, TOOLS_PASSWORD,
// E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.

const SHOULD_RUN =
  process.env.E2E_RUN === 'true' &&
  Boolean(process.env.WEB_BASE_URL) &&
  Boolean(process.env.TOOLS_USER) &&
  Boolean(process.env.TOOLS_PASSWORD);

const it = SHOULD_RUN ? test : test.skip;

const MARKER_PREFIX = "');window.__opsToolsMarker=1;//";
const DELETE_LIST = /^L.schen$/;
const DELETE_DETAIL = /^Map l.schen$/;
let adminToken = '';
let tenantId = '';
let adminSessionCookies: Parameters<BrowserContext['addCookies']>[0] = [];

const EVENT_ATTR_TOOLS = [
  'super-admin.html',
  'map-editor.html',
  'avatar-pack-manager.html',
  'npc-admin.html',
] as const;

const ROOT_TOOLS = [
  ...EVENT_ATTR_TOOLS,
  'sprite-asset-cutter.html',
  'ui-prototype.html',
] as const;

const ATELIER_PATHS = [
  '/tools/asset-lab/index.html',
  '/tools/asset-lab/design/compact-collection.html',
  '/tools/asset-lab/design/detail-study.html',
] as const;

type MarkerAction = 'copy-list' | 'delete-list' | 'copy-detail' | 'delete-detail';

test.use({
  httpCredentials: {
    username: process.env.TOOLS_USER ?? '',
    password: process.env.TOOLS_PASSWORD ?? '',
  },
});

function toolsAuthorization(): string {
  const user = process.env.TOOLS_USER ?? '';
  const password = process.env.TOOLS_PASSWORD ?? '';
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
}

function adminAuthorization(): string {
  return `Bearer ${adminToken}`;
}

test.beforeAll(async ({ playwright }) => {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Missing required environment variables: E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD');
  }

  const api = await playwright.request.newContext({ baseURL: process.env.WEB_BASE_URL });
  try {
    const response = await api.post('/auth/login', {
      headers: { Origin: 'tauri://localhost' },
      data: { email, password },
    });
    expect(response.status(), 'admin login must succeed').toBe(200);
    const body = (await response.json()) as { token?: string };
    expect(body.token, 'admin login must return a session token').toBeTruthy();
    adminToken = body.token ?? '';
    const claims = JSON.parse(Buffer.from(adminToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      tid?: string;
    };
    expect(claims.tid, 'admin session must include a tenant claim').toBeTruthy();
    tenantId = claims.tid ?? '';
    // The super admin tool only accepts the browser session, so the page reuses
    // the session cookie of this login instead of typing a token.
    adminSessionCookies = (await api.storageState()).cookies;
    expect(adminSessionCookies.length, 'admin login must set a session cookie').toBeGreaterThan(0);
  } finally {
    await api.dispose();
  }
});

function probeMapName(): string {
  return `${MARKER_PREFIX}${crypto.randomUUID()}`;
}

function countEventAttributesInBytes(html: string): number {
  return [...html.matchAll(/<[^>]*\son[a-z]+\s*=/gi)].length;
}

function parseCsp(header: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of header.split(';')) {
    const bits = part.trim().split(/\s+/).filter(Boolean);
    if (bits.length === 0) continue;
    directives.set(bits[0].toLowerCase(), bits.slice(1));
  }
  return directives;
}

function assertOperatorToolsCsp(header: string | undefined): void {
  expect(header, 'Content-Security-Policy header is missing').toBeTruthy();
  const directives = parseCsp(header ?? '');
  const values = [...directives.values()].flat();
  expect(values).not.toContain("'unsafe-inline'");
  expect(values).not.toContain("'unsafe-hashes'");
  expect(values).not.toContain("'unsafe-eval'");
  expect(directives.get('script-src-attr')).toEqual(["'none'"]);
  expect(directives.get('object-src')).toEqual(["'none'"]);
  expect(directives.get('base-uri')).toEqual(["'none'"]);
  expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
}

async function toolsGet(request: APIRequestContext, path: string) {
  return request.get(path, { headers: { Authorization: toolsAuthorization() } });
}

async function countEventAttributesInDom(page: Page): Promise<number> {
  return page.evaluate(() => {
    let count = 0;
    for (const el of document.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        if (/^on[a-z]+$/i.test(attr.name)) count += 1;
      }
    }
    return count;
  });
}

async function markerValue(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const w: Window & { __opsToolsMarker?: unknown } = window;
    return w.__opsToolsMarker;
  });
}

function mapRow(page: Page, mapName: string) {
  return page.getByRole('row').filter({ hasText: mapName });
}

async function createProbeMap(request: APIRequestContext): Promise<{ id: string; name: string }> {
  const name = probeMapName();
  const res = await request.post('/admin/maps', {
    headers: {
      Authorization: adminAuthorization(),
      'Content-Type': 'application/json',
    },
    data: {
      tenantId,
      name,
      width: 8,
      height: 8,
      tileWidth: 16,
      tileHeight: 16,
    },
  });
  expect(res.status(), 'creating the probe map must succeed').toBe(200);
  const body = (await res.json()) as { id: string; name: string };
  expect(body.name).toBe(name);
  return { id: body.id, name };
}

async function deleteProbeMap(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`/admin/maps/${id}`, { headers: { Authorization: adminAuthorization() } });
}

async function openSuperAdmin(page: Page): Promise<void> {
  page.on('dialog', async (dialog) => {
    await dialog.dismiss();
  });
  await page.goto('/tools/super-admin.html');
}

async function connectAndOpenMaps(page: Page): Promise<void> {
  await page.context().addCookies(adminSessionCookies);
  await openSuperAdmin(page);
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(page.getByText('Verbunden mit Server')).toBeVisible();
  await page.getByText('Maps', { exact: true }).click();
  await expect(page.getByText('Karten verwalten, importieren und zwischen Tenants kopieren')).toBeVisible();
}

async function expectProbeMapLiteral(page: Page, mapName: string): Promise<void> {
  await expect(mapRow(page, mapName).getByText(mapName, { exact: true })).toBeVisible();
}

async function runMarkerAction(page: Page, mapName: string, action: MarkerAction): Promise<void> {
  const row = mapRow(page, mapName);
  if (action === 'copy-list') {
    await row.getByRole('button', { name: 'Kopieren' }).click();
    return;
  }
  if (action === 'delete-list') {
    await row.getByRole('button', { name: DELETE_LIST }).click();
    await page.getByRole('button', { name: 'Abbrechen' }).click();
    return;
  }
  await row.getByText(mapName, { exact: true }).click();
  if (action === 'copy-detail') {
    await page.getByRole('button', { name: 'Map kopieren' }).click();
    return;
  }
  await page.getByRole('button', { name: DELETE_DETAIL }).click();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
}

test.describe('operator tools security', () => {
  for (const file of EVENT_ATTR_TOOLS) {
    it(`${file} has no HTML event attributes in delivered bytes or rendered DOM`, async ({ page, request }) => {
      const path = `/tools/${file}`;
      const res = await toolsGet(request, path);
      expect(res.status(), `${path} must be served`).toBe(200);
      expect(countEventAttributesInBytes(await res.text())).toBe(0);

      if (file === 'super-admin.html') {
        const map = await createProbeMap(request);
        try {
          await connectAndOpenMaps(page);
          await expectProbeMapLiteral(page, map.name);
        } finally {
          await deleteProbeMap(request, map.id);
        }
      } else {
        await page.goto(path);
      }

      expect(await countEventAttributesInDom(page)).toBe(0);
    });
  }

  const markerCases: Array<{ action: MarkerAction; title: string }> = [
    { action: 'copy-list', title: 'copying a map from the list' },
    { action: 'delete-list', title: 'deleting a map from the list' },
    { action: 'copy-detail', title: 'copying a map from the detail view' },
    { action: 'delete-detail', title: 'deleting a map from the detail view' },
  ];

  for (const { action, title } of markerCases) {
    it(`${title} does not run a name marker and shows the name as text`, async ({ page, request }) => {
      const map = await createProbeMap(request);
      try {
        await connectAndOpenMaps(page);
        await expectProbeMapLiteral(page, map.name);
        await runMarkerAction(page, map.name, action);
        expect(await markerValue(page)).toBeUndefined();
        await expectProbeMapLiteral(page, map.name);
      } finally {
        await deleteProbeMap(request, map.id);
      }
    });
  }

  for (const file of ROOT_TOOLS) {
    it(`${file} response sends the operator tools Content-Security-Policy`, async ({ request }) => {
      const path = `/tools/${file}`;
      const res = await toolsGet(request, path);
      expect(res.status(), `${path} must be served`).toBe(200);
      assertOperatorToolsCsp(res.headers()['content-security-policy']);
    });
  }

  for (const path of ATELIER_PATHS) {
    it(`${path} is not served under /tools`, async ({ request }) => {
      const res = await toolsGet(request, path);
      expect(res.status()).toBe(404);
    });
  }

  it('super-admin maps navigation still works', async ({ page }) => {
    await openSuperAdmin(page);
    await page.getByText('Maps', { exact: true }).click();
    await expect(page.getByText('Karten verwalten, importieren und zwischen Tenants kopieren')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Neue Map' })).toBeVisible();
  });

  it('super-admin maps tenant filter still re-renders', async ({ page, request }) => {
    const map = await createProbeMap(request);
    try {
      await connectAndOpenMaps(page);
      await expectProbeMapLiteral(page, map.name);
      await page.getByRole('combobox').selectOption({ index: 0 });
      await expectProbeMapLiteral(page, map.name);
      await expect(mapRow(page, map.name).getByRole('button', { name: 'Kopieren' })).toBeVisible();
    } finally {
      await deleteProbeMap(request, map.id);
    }
  });

  it('super-admin new map form still accepts edits', async ({ page }) => {
    await openSuperAdmin(page);
    await page.getByText('Maps', { exact: true }).click();
    await page.getByRole('button', { name: '+ Neue Map' }).click();
    await expect(page.getByText('Neue Map erstellen')).toBeVisible();
    const nameField = page.getByPlaceholder('Meine Karte');
    await nameField.fill('ops-tools-form-probe');
    await expect(nameField).toHaveValue('ops-tools-form-probe');
  });

  it('super-admin maps list still re-renders after a form toggle and section change', async ({ page, request }) => {
    const map = await createProbeMap(request);
    try {
      await connectAndOpenMaps(page);
      await expectProbeMapLiteral(page, map.name);
      await page.getByRole('button', { name: '+ Neue Map' }).click();
      await expect(page.getByText('Neue Map erstellen')).toBeVisible();
      await page.getByRole('button', { name: 'Abbrechen' }).click();
      await expect(page.getByText('Neue Map erstellen')).toHaveCount(0);
      await expectProbeMapLiteral(page, map.name);
      await page.getByText('Mandanten', { exact: true }).click();
      await page.getByText('Maps', { exact: true }).click();
      await expectProbeMapLiteral(page, map.name);
    } finally {
      await deleteProbeMap(request, map.id);
    }
  });
});
