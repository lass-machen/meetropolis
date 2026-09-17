import './style.css';
import JSZip from 'jszip';
import atelierLicense from '../LICENSE?raw';
import sharedLicense from '../../../packages/shared/LICENSE?raw';
import sharedNotice from '../../../packages/shared/sprite/NOTICE?raw';
import { assetDefinitions, themes, type AssetId, type ThemeId } from './assets.ts';
import { characterSheet, hairColorsFor } from './avatar.ts';
import { AvatarEditor } from './avatar-editor.ts';
import { paint, png, download, toCanvas } from './canvas.ts';
import { draftAssets, newDraft, parseDraft, storageKey, type PixelEdits } from './draft.ts';
import { packZip, officeRecipe } from './pack.ts';
import { createOffice } from './scene.ts';
import { roomImage, prepareRoom, flattenRoom } from './world.ts';
import { officeList, officePresets } from './office-presets.ts';
import { OfficePicker } from './office-picker.ts';
import type { OfficeId } from './office-model.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="/" aria-label="Meetropolis Asset-Atelier"><span class="brand-mark" aria-hidden="true">m</span>meetropolis <span class="brand-divider">/</span> <span class="brand-sub">Asset-Atelier</span></a>
    <span class="local-badge"><i></i> Lokale Werkstatt</span>
  </header>
  <main>
    <div class="heading"><div><p class="eyebrow">PIXEL FÜR PIXEL</p><h1>Ein Büro, das sich nach uns anfühlt.</h1><p>Eigene Räume. Eigene Figuren. Ein gemeinsamer Stil.</p></div>
      <button class="primary" id="export-draft"><span aria-hidden="true">↓</span> Entwurf exportieren</button>
    </div>
    <div class="workspace">
      <section class="studio" aria-label="Raum und Assets">
        <div id="office-picker"></div>
        <div class="theme-list palette-list" role="group" aria-label="Farbstimmung"><span>Farbstimmung</span>${Object.entries(
          themes,
        )
          .map(
            ([id, t]) =>
              `<button class="theme" data-theme="${id}" aria-pressed="${id === 'holz'}"><i style="background:${t.fabric}"></i><strong>${t.name}</strong></button>`,
          )
          .join('')}</div>
        <div class="workbench">
          <div class="bench-bar"><div class="tabs" role="tablist" aria-label="Arbeitsansicht">
            <button role="tab" id="room-tab" aria-selected="true" aria-controls="room-panel" tabindex="0">Raum erkunden</button>
            <button role="tab" id="characters-tab" aria-selected="false" aria-controls="characters-panel" tabindex="-1">Figur gestalten</button>
            <button role="tab" id="pixel-tab" aria-selected="false" aria-controls="pixel-panel" tabindex="-1">Pixel bearbeiten</button>
          </div><label class="guide-toggle"><input id="guides" type="checkbox"> Raster & Kollisionen</label></div>
          <div id="room-panel" role="tabpanel" aria-labelledby="room-tab">
            <div class="room-title"><strong id="office-name">Team-Loft</strong><span id="office-detail"></span></div>
            <div id="game"></div>
            <div class="zone-card"><span class="zone-dot"></span><div><strong id="zone-name">Freier Bereich</strong><p id="zone-detail">Klicke in den Raum und erkunde das Büro.</p></div></div><div class="room-footer"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> oder in den Raum klicken</span><button id="overview" class="text-button" aria-pressed="false">Ganzes Büro ansehen</button><button id="reset-position" class="text-button">Zurück zum Start <span aria-hidden="true">↺</span></button></div>
          </div>
          <div id="pixel-panel" role="tabpanel" aria-labelledby="pixel-tab" hidden>
            <div class="pixel-heading"><div><h2 id="asset-name">Schreibtisch</h2><p id="asset-dimensions"></p></div><button class="secondary small" id="export-asset">PNG herunterladen ↓</button></div>
            <div class="pixel-workspace"><div class="pixel-stage"><canvas id="pixel-canvas" aria-label="Pixelraster zum Zeichnen mit Maus oder Stift"></canvas></div>
              <div class="pixel-tools"><p class="eyebrow">DEIN WERKZEUG</p><div class="tool-switch" role="group" aria-label="Pixelwerkzeug"><button id="pencil" aria-pressed="true">Stift</button><button id="eraser" aria-pressed="false">Radierer</button></div>
                <label class="color-label">Zeichenfarbe <input id="brush" type="color" value="#d7956f"></label><div id="asset-palette" class="asset-palette" aria-label="Farben dieses Assets"></div>
                <p class="muted">Ein Kästchen ist ein Pixel. Deine Änderungen erscheinen direkt im Raum.</p>
                <button id="undo-pixel" class="secondary small" disabled>Letzten Strich zurück</button><button id="reset-asset" class="text-button">Asset zurücksetzen</button>
              </div>
            </div>
          </div>
          <div id="characters-panel" role="tabpanel" aria-labelledby="characters-tab" hidden><div id="character-editor"></div></div>
        </div>
        <div class="library-heading"><h2>Die Bausteine</h2><span>Asset auswählen und Pixel bearbeiten</span></div>
        <div id="asset-library" class="asset-library" role="group" aria-label="Asset auswählen">${Object.entries(
          assetDefinitions,
        )
          .map(
            ([id, spec]) =>
              `<button data-asset="${id}" aria-pressed="${id === 'compact_desk'}"><canvas aria-hidden="true"></canvas><span>${spec.name}</span></button>`,
          )
          .join('')}</div>
        <p class="scope-note">Raumstudie für die gemeinsame Abnahme. Die Gesprächszonen zeigen die Aufteilung; Audio ist hier nicht verbunden.</p>
      </section>

    </div>
    <footer class="page-footer"><span id="save-state">Änderungen bleiben in diesem Browser.</span><div><button class="text-button" id="save-recipe">Rezept speichern</button><button class="text-button" id="load-recipe">Rezept öffnen</button><input id="recipe-file" type="file" accept="application/json,.json" hidden></div></footer>
    <div id="message" role="status" aria-live="polite" hidden></div>
  </main>`;

const el = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
let messageTimeout: ReturnType<typeof setTimeout>;
function message(text: string, error = false): void {
  clearTimeout(messageTimeout);
  const close = document.createElement('button');
  close.textContent = '×';
  close.setAttribute('aria-label', 'Meldung schließen');
  close.onclick = () => {
    el('#message').hidden = true;
  };
  el('#message').replaceChildren(document.createTextNode(text), close);
  el('#message').classList.toggle('error', error);
  el('#message').hidden = false;
  if (!error)
    messageTimeout = setTimeout(() => {
      el('#message').hidden = true;
    }, 6000);
}
function report(error: unknown): void {
  console.error(error);
  message(error instanceof Error ? error.message : String(error), true);
}

let draft = newDraft();
try {
  const saved = localStorage.getItem(storageKey);
  if (saved) draft = parseDraft(saved);
} catch (error) {
  report(error);
}
let assets = draftAssets(draft);
let selectedAsset: AssetId = 'compact_desk';
let previewDirection = 0;
let previewWalking = true;
let sheet = toCanvas(characterSheet(draft.character));
let brush: string | null = '#d7956f';
const history = new Map<string, PixelEdits[]>();
const historyKey = (): string => `${draft.theme}/${selectedAsset}`;
const { game, scene } = createOffice(el('#game'), (state) => {
  if (el('#zone-name').textContent !== state.zone) {
    el('#zone-name').textContent = state.zone;
    el('#zone-detail').textContent = state.detail;
  }
});
const editor = new AvatarEditor(el('#character-editor'), (character) => {
  draft.character = character;
  syncCharacter();
  persist();
});
let entryStage: 'office' | 'character' | 'room' = 'office';
const picker = new OfficePicker(el('#office-picker'), officeList, {
  select: selectOffice,
  design: () => {
    setTab('characters');
    el('#characters-panel').scrollIntoView({ block: 'start' });
  },
  enter: () => {
    setTab('room');
    scene.resetPosition();
    el('#game').scrollIntoView({ block: 'center' });
    game.canvas.focus({ preventScroll: true });
  },
});
scene.setCharacter(draft.character);

function renderOfficePicker(): void {
  picker.render(
    draft.office,
    (office) =>
      roomImage(
        office.id === draft.office ? draft.theme : office.defaultTheme,
        office.id === draft.office ? assets : draftAssets(draft, office.defaultTheme),
        office,
      ),
    entryStage,
  );
}

function refreshRoomContext(): void {
  const office = officePresets[draft.office];
  const render = prepareRoom(draft.theme, assets, office);
  scene.setRoom(office, assets, render);
  const room = flattenRoom(render);
  editor.setRoom(room, office.spawn, office.name);
  el('#office-name').textContent = office.name;
  el('#office-detail').textContent = office.subtitle;
}

function selectOffice(id: OfficeId): void {
  if (id === draft.office) return;
  draft.office = id;
  draft.theme = officePresets[id].defaultTheme;
  assets = draftAssets(draft);
  el('#overview').setAttribute('aria-pressed', 'false');
  el('#overview').textContent = 'Ganzes Büro ansehen';
  refreshRoomContext();
  renderLibrary();
  renderOfficePicker();
  renderPixelEditor();
  persist();
}

function persist(): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(draft));
    el('#save-state').textContent = 'In diesem Browser gespeichert.';
  } catch (error) {
    el('#save-state').textContent = 'Speichern fehlgeschlagen. Bitte lade dein Rezept herunter.';
    report(error);
  }
}

function renderLibrary(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-asset]')) {
    const id = button.dataset.asset as AssetId;
    paint(button.querySelector('canvas')!, assets[id]);
    button.setAttribute('aria-pressed', String(id === selectedAsset));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-theme]')) {
    const theme = button.dataset.theme as ThemeId;
    button.setAttribute('aria-pressed', String(theme === draft.theme));
  }
}

function syncCharacter(): void {
  sheet = toCanvas(characterSheet(draft.character));
  scene.setCharacter(draft.character);
  editor.setCharacter(draft.character);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-skin]'))
    button.setAttribute('aria-pressed', String(button.dataset.skin === draft.character.skin));
  const colors = hairColorsFor(draft.character);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-hair-color]')) {
    button.style.setProperty('--swatch', colors[button.dataset.hairColor!]);
    button.setAttribute('aria-pressed', String(button.dataset.hairColor === draft.character.hair_color));
  }
  el('#hood-note').hidden = draft.character.hat !== 'hood';
}

const views = ['room', 'characters', 'pixel'] as const;
type WorkingView = (typeof views)[number];
let selectedView: WorkingView = 'room';
function setTab(view: WorkingView): void {
  selectedView = view;
  for (const id of views) {
    el(`#${id}-panel`).hidden = id !== view;
    el(`#${id}-tab`).setAttribute('aria-selected', String(id === view));
    el(`#${id}-tab`).tabIndex = id === view ? 0 : -1;
  }
  el('.guide-toggle').hidden = view !== 'room';
  if (view === 'pixel') renderPixelEditor();
  if (view === 'room') window.dispatchEvent(new Event('resize'));
  if (view !== 'pixel') entryStage = view === 'characters' ? 'character' : 'room';
  renderOfficePicker();
}
for (const view of views) el(`#${view}-tab`).onclick = () => setTab(view);
el('.tabs').onkeydown = (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? views.length - 1
        : (views.indexOf(selectedView) + (event.key === 'ArrowRight' ? 1 : -1) + views.length) % views.length;
  setTab(views[index]);
  el(`#${views[index]}-tab`).focus();
};
el<HTMLInputElement>('#guides').onchange = (event) => scene.setGuides((event.target as HTMLInputElement).checked);
el('#reset-position').onclick = () => scene.resetPosition();
el('#overview').onclick = () => {
  const enabled = el('#overview').getAttribute('aria-pressed') !== 'true';
  scene.setOverview(enabled);
  el('#overview').setAttribute('aria-pressed', String(enabled));
  el('#overview').textContent = enabled ? 'Der Figur folgen' : 'Ganzes Büro ansehen';
};

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-theme]'))
  button.onclick = () => {
    draft.theme = button.dataset.theme as ThemeId;
    assets = draftAssets(draft);
    refreshRoomContext();
    renderOfficePicker();
    renderLibrary();
    renderPixelEditor();
    persist();
  };
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-asset]'))
  button.onclick = () => {
    selectedAsset = button.dataset.asset as AssetId;
    renderLibrary();
    setTab('pixel');
  };
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-skin]'))
  button.onclick = () => {
    draft.character.skin = button.dataset.skin!;
    syncCharacter();
    persist();
  };
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-hair-color]'))
  button.onclick = () => {
    draft.character.hair_color = button.dataset.hairColor!;
    draft.character.beard_color = button.dataset.hairColor!;
    syncCharacter();
    persist();
  };
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-direction]'))
  button.onclick = () => {
    previewDirection = Number(button.dataset.direction);
    editor.setDirection(previewDirection);
    for (const other of document.querySelectorAll('[data-direction]'))
      other.setAttribute('aria-pressed', String(other === button));
  };
el('#preview-walk').onclick = () => {
  previewWalking = !previewWalking;
  el('#preview-walk').setAttribute('aria-pressed', String(previewWalking));
};
if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  previewWalking = false;
  el('#preview-walk').setAttribute('aria-pressed', 'false');
}
const preview = el<HTMLCanvasElement>('#avatar-preview');
function animatePreview(time: number): void {
  const context = preview.getContext('2d')!;
  context.clearRect(0, 0, 128, 128);
  context.imageSmoothingEnabled = false;
  const row = previewWalking ? previewDirection + 4 : previewDirection;
  const col = previewWalking ? Math.floor(time / 125) % 4 : 0;
  context.drawImage(sheet, col * 32, row * 32, 32, 32, 0, 0, 128, 128);
  if (selectedView === 'characters') {
    editor.drawRoom(sheet, row, col);
  }
  requestAnimationFrame(animatePreview);
}
requestAnimationFrame(animatePreview);

const pixelCanvas = el<HTMLCanvasElement>('#pixel-canvas');
const cell = 8;
function drawPixels(): void {
  const pixels = assets[selectedAsset];
  pixelCanvas.width = pixels.width * cell;
  pixelCanvas.height = pixels.height * cell;
  const context = pixelCanvas.getContext('2d')!;
  for (let y = 0; y < pixels.height; y++)
    for (let x = 0; x < pixels.width; x++) {
      context.fillStyle = (x + y) % 2 ? '#e7eae5' : '#fafaf5';
      context.fillRect(x * cell, y * cell, cell, cell);
    }
  context.imageSmoothingEnabled = false;
  context.drawImage(toCanvas(pixels), 0, 0, pixelCanvas.width, pixelCanvas.height);
  context.strokeStyle = 'rgba(38, 65, 53, 0.12)';
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 0; x <= pixels.width; x++) {
    context.moveTo(x * cell + 0.5, 0);
    context.lineTo(x * cell + 0.5, pixelCanvas.height);
  }
  for (let y = 0; y <= pixels.height; y++) {
    context.moveTo(0, y * cell + 0.5);
    context.lineTo(pixelCanvas.width, y * cell + 0.5);
  }
  context.stroke();
  el<HTMLButtonElement>('#undo-pixel').disabled = !history.get(historyKey())?.length;
}

function setBrush(color: string | null): void {
  brush = color;
  el('#pencil').setAttribute('aria-pressed', String(color !== null));
  el('#eraser').setAttribute('aria-pressed', String(color === null));
  if (color) el<HTMLInputElement>('#brush').value = color;
}

function renderPixelEditor(): void {
  el('#asset-name').textContent = assetDefinitions[selectedAsset].name;
  const pixels = assets[selectedAsset];
  el('#asset-dimensions').textContent = `${pixels.width} × ${pixels.height} Pixel · ${themes[draft.theme].name}`;
  drawPixels();
  const colors = new Set<string>();
  for (let i = 0; i < pixels.data.length; i += 4)
    if (pixels.data[i + 3])
      colors.add(`#${[...pixels.data.slice(i, i + 3)].map((n) => n.toString(16).padStart(2, '0')).join('')}`);
  el('#asset-palette').replaceChildren(
    ...[...colors].map((color) => {
      const button = document.createElement('button');
      button.style.background = color;
      button.setAttribute('aria-label', `Zeichenfarbe ${color}`);
      button.title = color;
      button.onclick = () => setBrush(color);
      return button;
    }),
  );
}
el('#pencil').onclick = () => setBrush(el<HTMLInputElement>('#brush').value);
el('#eraser').onclick = () => setBrush(null);
el<HTMLInputElement>('#brush').oninput = (event) => setBrush((event.target as HTMLInputElement).value);

function rememberStroke(): void {
  const stack = history.get(historyKey()) ?? [];
  stack.push(structuredClone(draft.edits[draft.theme]?.[selectedAsset] ?? {}));
  history.set(historyKey(), stack);
}

function refreshAssets(): void {
  assets = draftAssets(draft);
  refreshRoomContext();
  renderLibrary();
  drawPixels();
}
let painting = false;
let previousPixel: { x: number; y: number } | null = null;
function stroke(event: PointerEvent): void {
  const bounds = pixelCanvas.getBoundingClientRect();
  const pixels = assets[selectedAsset];
  const x = Math.floor(((event.clientX - bounds.left) / bounds.width) * pixels.width);
  const y = Math.floor(((event.clientY - bounds.top) / bounds.height) * pixels.height);
  if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) {
    previousPixel = null;
    return;
  }
  const from = previousPixel ?? { x, y };
  const count = Math.max(1, Math.abs(x - from.x), Math.abs(y - from.y));
  const themeEdits = (draft.edits[draft.theme] ??= {});
  const edits = (themeEdits[selectedAsset] ??= {});
  for (let i = 0; i <= count; i++)
    edits[`${Math.round(from.x + ((x - from.x) * i) / count)},${Math.round(from.y + ((y - from.y) * i) / count)}`] =
      brush;
  previousPixel = { x, y };
  refreshAssets();
}
pixelCanvas.onpointerdown = (event) => {
  if (event.button !== 0) return;
  painting = true;
  previousPixel = null;
  rememberStroke();
  pixelCanvas.setPointerCapture(event.pointerId);
  stroke(event);
};
pixelCanvas.onpointermove = (event) => {
  if (painting) stroke(event);
};
const finishStroke = (): void => {
  if (painting) {
    painting = false;
    previousPixel = null;
    persist();
    renderOfficePicker();
  }
};
pixelCanvas.onpointerup = finishStroke;
pixelCanvas.onpointercancel = finishStroke;
el('#undo-pixel').onclick = () => {
  const previous = history.get(historyKey())?.pop();
  if (previous) {
    (draft.edits[draft.theme] ??= {})[selectedAsset] = previous;
    refreshAssets();
    renderPixelEditor();
    renderOfficePicker();
    persist();
  }
};
el('#reset-asset').onclick = () => {
  rememberStroke();
  delete draft.edits[draft.theme]?.[selectedAsset];
  refreshAssets();
  renderPixelEditor();
  renderOfficePicker();
  persist();
};

el('#save-recipe').onclick = () =>
  download(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }), 'atelier-rezept.json');
el('#load-recipe').onclick = () => el<HTMLInputElement>('#recipe-file').click();
el<HTMLInputElement>('#recipe-file').onchange = async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('Das Rezept ist größer als 2 MB.');
    draft = parseDraft(await file.text());
    history.clear();
    el('#overview').setAttribute('aria-pressed', 'false');
    el('#overview').textContent = 'Ganzes Büro ansehen';
    refreshAssets();
    renderOfficePicker();
    syncCharacter();
    renderPixelEditor();
    persist();
    message('Rezept geöffnet. Figur und Pixeländerungen sind wiederhergestellt.');
  } catch (error) {
    report(error);
  }
  input.value = '';
};
el('#export-asset').onclick = async () => {
  try {
    download(await png(assets[selectedAsset]), `${draft.theme}-${selectedAsset}.png`);
  } catch (error) {
    report(error);
  }
};
el('#export-character').onclick = async () => {
  try {
    download(await png(characterSheet(draft.character)), 'atelier-figur-128x256.png');
  } catch (error) {
    report(error);
  }
};
el<HTMLButtonElement>('#export-draft').onclick = async () => {
  const button = el<HTMLButtonElement>('#export-draft');
  button.disabled = true;
  try {
    const snapshot = structuredClone(draft);
    const pixels = draftAssets(snapshot);
    const encoded = new Map<AssetId, Uint8Array>();
    for (const id of Object.keys(pixels) as AssetId[])
      encoded.set(id, new Uint8Array(await (await png(pixels[id])).arrayBuffer()));
    const zip = new JSZip();
    zip.file('atelier-rezept.json', JSON.stringify(snapshot, null, 2));
    zip.file('raum-rezept.json', JSON.stringify(officeRecipe(snapshot), null, 2));
    zip.file(
      'raum.png',
      await (await png(roomImage(snapshot.theme, pixels, officePresets[snapshot.office]))).arrayBuffer(),
    );
    zip.file('figur-128x256.png', await (await png(characterSheet(snapshot.character))).arrayBuffer());
    zip.file('LICENSE.txt', atelierLicense);
    zip.file('figur-MIT-LICENSE.txt', sharedLicense);
    zip.file('figur-NOTICE.txt', sharedNotice);
    zip.file(
      'LIESMICH.txt',
      'Meetropolis Asset-Atelier. Eigene Pixelvorlagen und Assets: MIT-Lizenz, siehe LICENSE.txt. Beim Weitergeben einzelner PNGs oder Packs die Lizenzhinweise beilegen.\n\nMöbel, Böden, Wand und Tür: eigene Pixelvorlagen in src/assets.ts, src/office-art.ts und src/office-compact.ts.\nFigur: MIT-Composer und Katalog aus packages/shared/sprite; eigene Körperform und Zubehör-Pixelraster in src/avatar-proportions.ts, src/avatar-compact.ts und src/avatar-accessories.ts sowie Gesichtsebenen in src/avatar.ts. Die Lizenzhinweise liegen bei.\n\nDas .mepack enthält die Asset-PNGs und config.json im bestehenden Asset-Pack-Format. Ein produktiver Import wurde nicht durchgeführt.\nDas Raumrezept beschreibt die lokale Studie und ist kein fertiger Import für den Map-Editor. Gesprächszonen haben hier keine Audiofunktion.\natelier-rezept.json kann im lokalen Atelier wieder geöffnet werden.\n',
    );
    zip.file(`atelier-${snapshot.theme}.mepack`, await packZip(snapshot.theme, pixels, (id) => encoded.get(id)!));
    for (const [id, bytes] of encoded) zip.file(`assets/${id}.png`, bytes);
    download(
      await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }),
      `atelier-${snapshot.office}-${snapshot.theme}-entwurf.zip`,
    );
    message('Entwurf exportiert: PNGs, Figur, Raumrezept und Asset-Pack.');
  } catch (error) {
    report(error);
  } finally {
    button.disabled = false;
  }
};

refreshRoomContext();
renderLibrary();
renderOfficePicker();
syncCharacter();
renderPixelEditor();
const openLinkedTab = (): void => {
  if (location.hash === '#figuren') setTab('characters');
};
window.addEventListener('hashchange', openLinkedTab);
openLinkedTab();
