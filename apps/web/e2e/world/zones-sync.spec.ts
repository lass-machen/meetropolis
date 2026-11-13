/**
 * Zwei-Client-E2E für den offenen Quellbefund Q-WE-7 (Zonen-Synchronisation).
 *
 * Die drei Fälle nutzen ausschließlich echte Wege: authentifizierte Owner-
 * und Admin-Konten aus dem echten Seed, echte Browser-Clients über die
 * loginAs-Fixtur, echte PUT-/GET-Aufrufe gegen /maps/:id/editor-state und echte
 * UI-Steuerelemente des Editors. Es gibt keine Route-Mocks, keine
 * Test-Hook-Injektion und keine erfundenen Nutzer oder Tokens.
 *
 * Belegte Selektoren (alle aus dem Produktcode, nicht erfunden):
 * - Menüknopf mit aria-label „Menü“/„Menu“
 *   (apps/web/src/ui/app/TopRightMenu.tsx:427, locales de/en common.json:5).
 * - Menüeintrag „Map-Editor öffnen“/„Open map editor“
 *   (TopRightMenu.tsx:310-316, common.json:10).
 * - Editorfenster „Map-Editor“ (apps/web/src/features/editor/EditorWindow.tsx:206)
 *   mit hartkodierten Reitern „Allgemein“ und „Zonen“ (EditorWindow.tsx:106-114).
 * - Zonenliste „Zonen-Verwaltung“/„Zone management“ mit Eingaben
 *   `input[id^="zone-name-"]` (apps/web/src/ui/editor/ZoneEditor.tsx:31,217)
 *   und Leerzustand „Noch keine Zonen …“/„No zones yet …“ (ZoneEditor.tsx:313).
 * - Hintergrund-Farbwahl auf dem Allgemein-Reiter
 *   (apps/web/src/ui/editor/EditorPanel.tsx:172-188) und Fußzeilen-Speichern
 *   „Speichern“/„Save“ (ui/editor/EditorPanel.tsx:428-447). Der Speichern-Knopf
 *   ruft über
 *   EditorWindow → WorldShell (WorldShell.tsx:209) saveAllToServerImpl auf, das
 *   PUT /maps/:id/editor-state mit replaceZones:true sendet
 *   (apps/web/src/app/routes/WorldApp.tsx:313-351).
 *
 * Belegte API-Verträge (aus den Routen abgeleitet, IDs nicht vorausgesetzt):
 * - GET /maps/:id/editor-state liefert { zones: [{ name, polygon, … }],
 *   backgroundColor, spawn } (apps/server/src/api/routes/maps.editor.zones.ts:34-72).
 * - PUT /maps/:id/editor-state akzeptiert { zones, replaceZones, backgroundColor }
 *   (maps.editor.zones.ts:74-83) und ersetzt bei zones:[] oder
 *   replaceZones:true den gesamten Zonenstand (maps.editor.zones.ts:116-148).
 *
 * Ausführung nur gegen den isolierten Stapel: E2E_RUN=true, MT_PROJECT=mtest-N
 * sowie Origin localhost mit den Ports aus MT_PORT_API/MT_PORT_WEB für API- und
 * Basis-URL (Namen und localhost-Form aus scripts/teststack.sh:378-390). Ohne
 * E2E_RUN wird die Datei sicher übersprungen; für die drei Fälle gibt es keine
 * weiteren Skips.
 */
import { randomUUID } from 'node:crypto';

import type { APIRequestContext, BrowserContext, Page, Response as PageResponse } from '@playwright/test';

import { expect, test } from '../fixtures';
import type { SeedData, TestUser } from '../support/api';
import { MeetropolisApi } from '../support/api';
import { getSeedTenant, passwordFor, waitForParticipant } from '../fixtures/helpers';

const SHOULD_RUN = process.env.E2E_RUN === 'true';

test.skip(!SHOULD_RUN, 'E2E_RUN=true erforderlich: diese Spec läuft nur gegen den isolierten Teststack.');

const LIVE_SYNC_TIMEOUT_MS = 20_000;
const UI_TIMEOUT_MS = 30_000;

type ZonePoint = { x: number; y: number };

type BaselineZone = {
  name: string;
  capacity: number | null;
  polygon: ZonePoint[];
  type: string | null;
  portalTarget: string | null;
  portalSpawnX: number | null;
  portalSpawnY: number | null;
};

type Baseline = { zones: BaselineZone[]; backgroundColor: string | null };

type ClientSession = { user: TestUser; context: BrowserContext; page: Page };

type StackEnv = { apiUrl: string; baseUrl: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Verlangt den isolierten Stapel und lehnt produktive Ziele geschlossen ab. */
function requireIsolatedStack(stack: StackEnv): void {
  const project = process.env.MT_PROJECT ?? '';
  if (!/^mtest-\d+$/.test(project)) {
    throw new Error(`MT_PROJECT muss mtest-<Nummer> sein, gefunden: ${project || '<leer>'}.`);
  }
  // Portnamen und localhost-Form stammen aus scripts/teststack.sh:378-390.
  const apiPort = process.env.MT_PORT_API ?? '';
  const webPort = process.env.MT_PORT_WEB ?? '';
  const targets: Array<[string, string, string, string]> = [
    ['E2E_API_URL', stack.apiUrl, 'MT_PORT_API', apiPort],
    ['E2E_BASE_URL', stack.baseUrl, 'MT_PORT_WEB', webPort],
  ];
  for (const [name, value, portName, expectedPort] of targets) {
    if (expectedPort === '') throw new Error(`${portName} fehlt: kein Soll-Port bekannt.`);
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} ist keine gültige URL.`);
    }
    if (url.protocol !== 'http:') throw new Error(`${name} muss Loopback-http verwenden.`);
    if (url.hostname !== 'localhost') throw new Error(`${name} muss Origin localhost haben.`);
    if (url.port === '') throw new Error(`${name} braucht einen expliziten Port (kein Standard-Fallback).`);
    const numeric = Number(url.port);
    if (!Number.isInteger(numeric) || numeric <= 0) throw new Error(`${name} hat keinen gültigen Port.`);
    if (numeric === 80 || numeric === 443) throw new Error(`${name} darf keinen Standard-Fallback-Port nutzen.`);
    if (url.port !== expectedPort) {
      throw new Error(`${name}-Port ${url.port} entspricht nicht ${portName}=${expectedPort}.`);
    }
  }
}

/** Holt Owner und Admin aus dem echten Seed; beide sind laut seed.setup.ts mit Passwort angelegt. */
function requireOwnerAndAdmin(seed: SeedData): {
  owner: TestUser;
  admin: TestUser;
  mapId: string;
  tenantSlug: string;
} {
  const tenant = getSeedTenant(seed);
  const owner = tenant.users.owner;
  const admin = tenant.users.admin;
  if (!owner?.password || !admin?.password) {
    throw new Error('Der Seed liefert keinen Owner und Admin mit Passwort (siehe support/seed.setup.ts).');
  }
  return { owner, admin, mapId: tenant.mapId, tenantSlug: tenant.slug };
}

function uniqueZoneName(tag: string): string {
  return `qwe7-${tag}-${randomUUID().slice(0, 8)}`;
}

function asPoints(value: unknown): ZonePoint[] {
  if (!Array.isArray(value)) return [];
  const points: ZonePoint[] = [];
  for (const entry of value) {
    if (Array.isArray(entry) && typeof entry[0] === 'number' && typeof entry[1] === 'number') {
      points.push({ x: entry[0], y: entry[1] });
    } else if (isRecord(entry) && typeof entry.x === 'number' && typeof entry.y === 'number') {
      points.push({ x: entry.x, y: entry.y });
    }
  }
  return points;
}

/** Liest Geometrie aus moderner (points) wie legacy (polygon / polygon.points) Form. */
function zonePoints(zone: Record<string, unknown>): ZonePoint[] {
  const direct = asPoints(zone.points ?? zone.polygon);
  if (direct.length > 0) return direct;
  return asPoints(isRecord(zone.polygon) ? zone.polygon.points : undefined);
}

function zoneNames(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.zones)) return [];
  return body.zones.filter(isRecord).map((zone) => (typeof zone.name === 'string' ? zone.name : ''));
}

/**
 * Baut einen datensparsamen Schnappschuss: nur Zonennamen, Geometrie und
 * Hintergrund. Keine IDs, keine Kundendaten, keine Auth-Spuren.
 */
function snapshotState(state: Record<string, unknown>): {
  zones: Array<{ name: string; geometry: ZonePoint[] }>;
  backgroundColor: string | null;
} {
  const zones = Array.isArray(state.zones) ? state.zones.filter(isRecord) : [];
  return {
    zones: zones.map((zone) => ({
      name: typeof zone.name === 'string' ? zone.name : '',
      geometry: zonePoints(zone),
    })),
    backgroundColor: typeof state.backgroundColor === 'string' ? state.backgroundColor : null,
  };
}

async function getEditorState(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
): Promise<Record<string, unknown>> {
  const response = await request.get(`${apiUrl}/maps/${encodeURIComponent(mapId)}/editor-state?t=${Date.now()}`);
  if (!response.ok()) throw new Error(`GET editor-state scheiterte: HTTP ${response.status()}.`);
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error('GET editor-state lieferte kein JSON-Objekt.');
  return body;
}

async function putEditorState(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  payload: unknown,
): Promise<void> {
  const response = await request.put(`${apiUrl}/maps/${encodeURIComponent(mapId)}/editor-state`, {
    data: payload,
  });
  if (!response.ok()) {
    throw new Error(`PUT editor-state scheiterte: HTTP ${response.status()} ${await response.text()}.`);
  }
}

/** Merkt sich Zonen und Hintergrund des Seed-Maps für die Wiederherstellung im finally. */
async function readBaseline(request: APIRequestContext, apiUrl: string, mapId: string): Promise<Baseline> {
  const state = await getEditorState(request, apiUrl, mapId);
  const zones = Array.isArray(state.zones) ? state.zones.filter(isRecord) : [];
  return {
    zones: zones.map((zone) => ({
      name: typeof zone.name === 'string' ? zone.name : 'Zone',
      capacity: typeof zone.capacity === 'number' ? zone.capacity : null,
      polygon: zonePoints(zone),
      type: typeof zone.type === 'string' ? zone.type : null,
      portalTarget: typeof zone.portalTarget === 'string' ? zone.portalTarget : null,
      portalSpawnX: typeof zone.portalSpawnX === 'number' ? zone.portalSpawnX : null,
      portalSpawnY: typeof zone.portalSpawnY === 'number' ? zone.portalSpawnY : null,
    })),
    backgroundColor: typeof state.backgroundColor === 'string' ? state.backgroundColor : null,
  };
}

/** Stellt ausschließlich den eigenen Ausgangsstand wieder her; Fehler bleiben sichtbar. */
async function restoreBaseline(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  baseline: Baseline,
): Promise<string[]> {
  try {
    await putEditorState(request, apiUrl, mapId, {
      zones: baseline.zones,
      replaceZones: true,
      ...(baseline.backgroundColor ? { backgroundColor: baseline.backgroundColor } : {}),
    });
    return [];
  } catch (error) {
    return [`Wiederherstellung scheiterte: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/**
 * Führt den Testkörper aus und stellt danach den Ausgangsstand wieder her.
 * Fehler aus Körper und Aufräumen werden verbunden, nie verschluckt.
 */
async function withBaseline(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  body: () => Promise<void>,
): Promise<void> {
  const baseline = await readBaseline(request, apiUrl, mapId);
  let bodyError: Error | null = null;
  try {
    await body();
  } catch (error) {
    bodyError = error instanceof Error ? error : new Error('Testkörper scheiterte ohne Fehlerobjekt.');
  }
  const restoreErrors = await restoreBaseline(request, apiUrl, mapId, baseline);
  if (bodyError) {
    if (restoreErrors.length > 0) {
      throw new Error(`${bodyError.message} | Aufräumen: ${restoreErrors.join('; ')}`);
    }
    throw bodyError;
  }
  if (restoreErrors.length > 0) throw new Error(`Aufräumen scheiterte: ${restoreErrors.join('; ')}`);
}

/** Meldet Owner und Admin als zwei echte, getrennte Browser-Clients an. */
async function openClients(
  loginAs: (user: TestUser) => Promise<{ context: BrowserContext; page: Page }>,
  owner: TestUser,
  admin: TestUser,
): Promise<[ClientSession, ClientSession]> {
  const first = await loginAs(owner);
  const second = await loginAs(admin);
  return [
    { user: owner, ...first },
    { user: admin, ...second },
  ];
}

/** Öffnet den Editor über das echte Menü und wechselt auf den Zonen-Reiter. */
async function openZonesTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^(Menü|Menu)$/ }).click();
  await page.getByRole('menuitem', { name: /Map-Editor öffnen|Open map editor/ }).click();
  await expect(page.getByText('Map-Editor', { exact: true })).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await page.getByRole('button', { name: 'Zonen', exact: true }).click();
  await expect(page.getByText(/Zonen-Verwaltung|Zone management/)).toBeVisible({ timeout: UI_TIMEOUT_MS });
}

/** Prüft die sichtbaren Zonennamen der Editorliste in Reihenfolge. */
async function expectZoneListNames(page: Page, names: string[]): Promise<void> {
  const inputs = page.locator('input[id^="zone-name-"]');
  await expect(inputs).toHaveCount(names.length, { timeout: UI_TIMEOUT_MS });
  for (const [index, name] of names.entries()) {
    await expect(page.locator(`#zone-name-${index}`)).toHaveValue(name, { timeout: UI_TIMEOUT_MS });
  }
}

async function expectZoneListEmpty(page: Page): Promise<void> {
  await expect(page.locator('input[id^="zone-name-"]')).toHaveCount(0, { timeout: UI_TIMEOUT_MS });
  await expect(page.getByText(/Noch keine Zonen|No zones yet/)).toBeVisible({ timeout: UI_TIMEOUT_MS });
}

/**
 * Fall 1 (Q-WE-7, Live-Aktualisierung): B speichert einen neuen Zonenstand
 * über seinen authentifizierten Request-Kontext, während A offen bleibt. Der
 * Test lauscht auf Seite A auf echte GET-editor-state-Antworten und verlangt,
 * dass mindestens eine den B-Stand enthält und die sichtbare Editorliste den
 * neuen Namen übernimmt. Eine Behauptung über pixelgenaue Overlay- oder
 * AV-Wirkung erfolgt bewusst nicht.
 */
test('Fall 1: offene Zonenliste übernimmt fremden Zonenstand live', async ({ stack, seed, loginAs, request }) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack);
  const { owner, admin, mapId, tenantSlug } = requireOwnerAndAdmin(seed);
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenantSlug);
  await ownerApi.login(owner.email, passwordFor(owner));
  const nameA = uniqueZoneName('a');
  const nameB = uniqueZoneName('b');
  const rectA: ZonePoint[] = [
    { x: 16, y: 16 },
    { x: 48, y: 16 },
    { x: 48, y: 48 },
    { x: 16, y: 48 },
  ];
  const rectB: ZonePoint[] = [
    { x: 48, y: 48 },
    { x: 80, y: 48 },
    { x: 80, y: 80 },
    { x: 48, y: 80 },
  ];

  await withBaseline(request, stack.apiUrl, mapId, async () => {
    await putEditorState(request, stack.apiUrl, mapId, {
      zones: [{ name: nameA, points: rectA }],
      replaceZones: true,
    });
    const [clientA, clientB] = await openClients(loginAs, owner, admin);
    // Gegenseitige Anwesenheit belegt zwei echte Clients im selben Raum;
    // die eindeutigen Zonennamen belegen zusätzlich den gemeinsamen Seed-Map.
    await waitForParticipant(clientA.page, clientB.user);
    await waitForParticipant(clientB.page, clientA.user);
    await openZonesTab(clientA.page);
    await openZonesTab(clientB.page);
    await expectZoneListNames(clientA.page, [nameA]);
    await expectZoneListNames(clientB.page, [nameA]);

    const seenBodies: unknown[] = [];
    const onResponse = (response: PageResponse): void => {
      if (response.request().method() !== 'GET') return;
      if (!response.url().includes(`/maps/${mapId}/editor-state`)) return;
      void response
        .json()
        .then((body: unknown) => {
          seenBodies.push(body);
        })
        .catch(() => {});
    };
    clientA.page.on('response', onResponse);
    try {
      // B speichert den neuen Stand über seinen authentifizierten Kontext (kein Canvas-Eingriff).
      await putEditorState(clientB.context.request, stack.apiUrl, mapId, {
        zones: [{ name: nameB, points: rectB }],
        replaceZones: true,
      });
      await expect
        .poll(() => seenBodies.some((body) => zoneNames(body).includes(nameB)), {
          timeout: LIVE_SYNC_TIMEOUT_MS,
          message: 'Q-WE-7/Fall 1: Seite A lud den B-Stand nie per GET editor-state nach (keine Live-Aktualisierung).',
        })
        .toBe(true);
    } finally {
      clientA.page.off('response', onResponse);
    }
    await expectZoneListNames(clientA.page, [nameB]);
  });
});

/**
 * Fall 2 (Q-WE-7, Überschreibschutz): A bleibt vom Anfangsstand A an
 * durchgehend offen. B speichert Stand B; A belegt den gespeicherten B-Stand
 * danach per frischem GET über seinen eigenen authentifizierten Kontext
 * (Name und Geometrie exakt), ohne den Editor neu zu laden. Erst danach
 * ändert A nur die Hintergrundfarbe über den echten Farb-Input und klickt
 * Speichern. Der abschließende frische GET muss B-Namen und B-Geometrie sowie
 * die neue Hintergrundfarbe enthalten. Beide Schnappschüsse liegen als
 * Testartefakt bei, der letzte vor den Assertions.
 */
test('Fall 2: Hintergrund-Speichern erhält fremden Zonenstand', async ({ stack, seed, loginAs, request }, testInfo) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack);
  const { owner, admin, mapId, tenantSlug } = requireOwnerAndAdmin(seed);
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenantSlug);
  await ownerApi.login(owner.email, passwordFor(owner));
  const nameA = uniqueZoneName('a');
  const nameB = uniqueZoneName('b');
  const rectB: ZonePoint[] = [
    { x: 48, y: 48 },
    { x: 80, y: 48 },
    { x: 80, y: 80 },
    { x: 48, y: 80 },
  ];
  const rectA: ZonePoint[] = [
    { x: 16, y: 16 },
    { x: 48, y: 16 },
    { x: 48, y: 48 },
    { x: 16, y: 48 },
  ];

  await withBaseline(request, stack.apiUrl, mapId, async () => {
    await putEditorState(request, stack.apiUrl, mapId, {
      zones: [{ name: nameA, points: rectA }],
      replaceZones: true,
    });
    const [clientA, clientB] = await openClients(loginAs, owner, admin);
    // Gegenseitige Anwesenheit belegt zwei echte Clients im selben Raum;
    // die eindeutigen Zonennamen belegen zusätzlich den gemeinsamen Seed-Map.
    await waitForParticipant(clientA.page, clientB.user);
    await waitForParticipant(clientB.page, clientA.user);
    await openZonesTab(clientA.page);
    await openZonesTab(clientB.page);
    await expectZoneListNames(clientA.page, [nameA]);
    await expectZoneListNames(clientB.page, [nameA]);

    // B speichert den neuen Stand über seinen authentifizierten Kontext.
    await putEditorState(clientB.context.request, stack.apiUrl, mapId, {
      zones: [{ name: nameB, points: rectB }],
      replaceZones: true,
    });

    // A bleibt offen und belegt den gespeicherten B-Stand per frischem GET.
    const stored = await getEditorState(clientA.context.request, stack.apiUrl, mapId);
    const storedZones = Array.isArray(stored.zones) ? stored.zones.filter(isRecord) : [];
    const storedB = storedZones.find((zone) => zone.name === nameB);
    expect(storedB, 'Der Server muss den B-Stand gespeichert haben.').toBeTruthy();
    expect(storedB ? zonePoints(storedB) : [], 'Der gespeicherte B-Stand muss die B-Geometrie tragen.').toEqual(rectB);
    await testInfo.attach('gespeicherter-b-stand', {
      body: JSON.stringify(snapshotState(stored), null, 2),
      contentType: 'application/json',
    });

    // A ändert nur die Hintergrundfarbe über den echten Farb-Input.
    const currentBg = typeof stored.backgroundColor === 'string' ? stored.backgroundColor : null;
    const newBg = currentBg?.toLowerCase() === '#334455' ? '#445566' : '#334455';
    await clientA.page.getByRole('button', { name: 'Allgemein', exact: true }).click();
    const colorInputs = clientA.page.locator('input[type="color"]');
    await expect(colorInputs).toHaveCount(1, { timeout: UI_TIMEOUT_MS });
    await colorInputs.first().fill(newBg);
    await expect(clientA.page.getByText(newBg, { exact: true })).toBeVisible({ timeout: UI_TIMEOUT_MS });

    // A speichert über den echten Fußzeilen-Knopf und wartet die echte PUT-Antwort ab.
    const savePut = clientA.page.waitForResponse(
      (response) => response.request().method() === 'PUT' && response.url().includes(`/maps/${mapId}/editor-state`),
      { timeout: UI_TIMEOUT_MS },
    );
    await clientA.page.getByRole('button', { name: /^(Speichern|Save)/ }).click();
    const saveResponse = await savePut;
    expect(saveResponse.ok(), `PUT editor-state scheiterte: HTTP ${saveResponse.status()}.`).toBe(true);

    const fresh = await getEditorState(clientA.context.request, stack.apiUrl, mapId);
    await testInfo.attach('beweisschnappschuss', {
      body: JSON.stringify(snapshotState(fresh), null, 2),
      contentType: 'application/json',
    });
    const freshZones = Array.isArray(fresh.zones) ? fresh.zones.filter(isRecord) : [];
    const kept = freshZones.find((zone) => zone.name === nameB);
    expect(kept, 'Der B-Stand muss nach As Hintergrund-Speichern erhalten bleiben.').toBeTruthy();
    expect(kept ? zonePoints(kept) : [], 'Die B-Geometrie muss unverändert bleiben.').toEqual(rectB);
    expect(fresh.backgroundColor, 'Die neue Hintergrundfarbe muss gespeichert sein.').toBe(newBg);
  });
});

/**
 * Fall 3 (Q-WE-7, letzte Zone live löschen): B ersetzt den Stand durch
 * zones:[]. Der frische Server-GET muss leer sein, und die sichtbaren
 * Zonenlisten beider durchgehend offener Clients müssen danach leer werden.
 * Kein Reload und kein sonstiges Remount ersetzt hier die
 * Live-Synchronisation. Pixel- oder AV-Wirkung wird nicht behauptet.
 */
test('Fall 3: geleerte Zonenliste erreicht beide offene Clients live', async ({ stack, seed, loginAs, request }) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack);
  const { owner, admin, mapId, tenantSlug } = requireOwnerAndAdmin(seed);
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenantSlug);
  await ownerApi.login(owner.email, passwordFor(owner));
  const nameA = uniqueZoneName('a');
  const rectA: ZonePoint[] = [
    { x: 16, y: 16 },
    { x: 48, y: 16 },
    { x: 48, y: 48 },
    { x: 16, y: 48 },
  ];

  await withBaseline(request, stack.apiUrl, mapId, async () => {
    await putEditorState(request, stack.apiUrl, mapId, {
      zones: [{ name: nameA, points: rectA }],
      replaceZones: true,
    });
    const [clientA, clientB] = await openClients(loginAs, owner, admin);
    // Gegenseitige Anwesenheit belegt zwei echte Clients im selben Raum;
    // die eindeutigen Zonennamen belegen zusätzlich den gemeinsamen Seed-Map.
    await waitForParticipant(clientA.page, clientB.user);
    await waitForParticipant(clientB.page, clientA.user);
    await openZonesTab(clientA.page);
    await openZonesTab(clientB.page);
    await expectZoneListNames(clientA.page, [nameA]);
    await expectZoneListNames(clientB.page, [nameA]);
    await putEditorState(clientB.context.request, stack.apiUrl, mapId, { zones: [] });

    const fresh = await getEditorState(request, stack.apiUrl, mapId);
    const freshZones = Array.isArray(fresh.zones) ? fresh.zones : [];
    expect(freshZones, 'Der Server muss nach zones:[] keine Zonen mehr liefern.').toHaveLength(0);

    // Beide Clients bleiben offen: die Live-Löschung muss ihre sichtbaren Listen leeren.
    await expectZoneListEmpty(clientA.page);
    await expectZoneListEmpty(clientB.page);
  });
});
