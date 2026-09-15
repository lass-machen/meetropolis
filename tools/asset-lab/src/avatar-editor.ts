import {
  characterSheet,
  extraHatNames,
  extraBeardNames,
  compactLooks,
  faceNames,
  hairNames,
  skinColors,
  hairColorsFor,
  proportions,
  type Character,
} from './avatar.ts';
import { paint, toCanvas } from './canvas.ts';
import type { Point } from './office-model.ts';
import { Pixels } from './pixels.ts';

type Slot = 'hair' | 'face' | 'outfit' | 'hat' | 'glasses' | 'beard' | 'proportion';
const slots: { id: Slot; name: string; choices: Record<string, string> }[] = [
  { id: 'hair', name: 'Haare', choices: hairNames },
  { id: 'face', name: 'Gesicht', choices: faceNames },
  {
    id: 'outfit',
    name: 'Kleidung',
    choices: {
      hoodie_blue: 'Hoodie',
      shirt_white: 'Shirt',
      suit_navy: 'Anzug',
      blazer_anthracite: 'Blazer',
      dress_red: 'Kleid',
      base: 'Basis',
    },
  },
  {
    id: 'hat',
    name: 'Kopf',
    choices: {
      '': 'Ohne',
      cap: 'Cap',
      cowboy: 'Cowboyhut',
      zylinder: 'Zylinder',
      krone: 'Krone',
      diadem: 'Diadem',
      hood: 'Kapuze',
      ...extraHatNames,
    },
  },
  {
    id: 'glasses',
    name: 'Brille',
    choices: { '': 'Ohne', round: 'Rund', rect: 'Eckig', prof: 'Breit' },
  },
  {
    id: 'beard',
    name: 'Bart',
    choices: {
      '': 'Ohne',
      schnauzer: 'Schnauzer',
      vollbart: 'Vollbart',
      ziegenbart: 'Ziegenbart',
      ...extraBeardNames,
    },
  },
  {
    id: 'proportion',
    name: 'Körper',
    choices: {
      ...Object.fromEntries(Object.entries(proportions).map(([id, p]) => [id, p.name])),
      '': 'Bisheriger Stand',
    },
  },
];

export class AvatarEditor {
  private character!: Character;
  private slot: Slot = 'hair';
  private direction = 0;
  private options: HTMLElement;
  private roomBackground?: HTMLCanvasElement;
  private roomPreview?: HTMLCanvasElement;
  private room?: { spawn: Point; cropX: number; cropY: number };
  constructor(
    private parent: HTMLElement,
    private change: (character: Character) => void,
  ) {
    parent.innerHTML = `<div class="editor-heading"><div><h2>Deine Figur. Direkt vor dir.</h2><p>Wähle ein Teil aus und sieh sofort, wie es deiner Figur steht.</p></div><button class="secondary small" id="export-character">Spritesheet speichern ↓</button></div>
      <div class="editor-layout"><div class="editor-model"><div class="avatar-stage"><canvas id="avatar-preview" width="128" height="128" aria-label="Animierte Vorschau deiner Figur"></canvas><span class="avatar-platform"></span></div>
      <div class="directions" role="group" aria-label="Blickrichtung">${['↓', '←', '→', '↑'].map((arrow, i) => `<button data-direction="${i}" aria-label="Blick ${['nach vorne', 'nach links', 'nach rechts', 'nach hinten'][i]}" aria-pressed="${i === 0}">${arrow}</button>`).join('')}<button id="preview-walk" aria-pressed="true">Laufen</button></div>
      <div class="editor-colors"><fieldset><legend>Hautfarbe</legend><div class="swatches">${Object.entries(skinColors)
        .map(
          ([id, color], i) =>
            `<button data-skin="${id}" style="--swatch:${color}" aria-label="Hautton ${i + 1}" aria-pressed="false"></button>`,
        )
        .join('')}</div></fieldset>
      <fieldset><legend>Haarfarbe</legend><div class="swatches">${['braun', 'blond', 'schwarz', 'rot', 'grau'].map((id) => `<button data-hair-color="${id}" aria-label="Haarfarbe ${id}" aria-pressed="false"></button>`).join('')}</div></fieldset></div>
      <div class="editor-looks" role="group" aria-label="Startlooks"><span>Startlook</span>${Object.entries(
        compactLooks,
      )
        .map(
          ([id, look]) =>
            `<button type="button" class="secondary small" data-compact-look="${id}">${look.name}</button>`,
        )
        .join('')}</div>
      <div class="avatar-room-probe"><div class="avatar-room-probe__heading"><strong id="editor-room-name">Dein Büro</strong><span>Raumprobe</span></div><canvas id="avatar-room-preview" width="256" height="160" aria-label="Raumprobe mit deiner Figur"></canvas></div>
      <p id="hood-note" class="muted" hidden>Die Kapuze verdeckt deine Frisur. <button class="text-button" data-remove-hood>Kapuze abnehmen</button></p></div>
      <div class="editor-wardrobe"><div class="editor-slots" role="tablist" aria-label="Teil der Figur">${slots.map((slot) => `<button role="tab" id="editor-tab-${slot.id}" data-slot="${slot.id}" aria-selected="${slot.id === 'hair'}" aria-controls="editor-options" tabindex="${slot.id === 'hair' ? 0 : -1}">${slot.name}</button>`).join('')}</div><div id="editor-options" class="editor-options" role="tabpanel"></div><p class="editor-hint">Alle Vorschauen zeigen deine aktuellen Farben. Drehe die Figur, um auch die Seite und Rückseite zu prüfen.</p></div></div>`;
    this.options = parent.querySelector('#editor-options')!;
    this.roomPreview = parent.querySelector('#avatar-room-preview')!;
    for (const button of parent.querySelectorAll<HTMLButtonElement>('[data-compact-look]'))
      button.onclick = () => {
        const look = compactLooks[button.dataset.compactLook!];
        if (look) this.change({ ...this.character, ...look.character });
      };
    for (const tab of parent.querySelectorAll<HTMLButtonElement>('[data-slot]'))
      tab.onclick = () => this.setSlot(tab.dataset.slot as Slot);
    parent.querySelector<HTMLElement>('.editor-slots')!.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const enabled = [...parent.querySelectorAll<HTMLButtonElement>('[data-slot]')].filter((tab) => !tab.disabled);
      const current = enabled.findIndex((tab) => tab.dataset.slot === this.slot);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? enabled.length - 1
            : (current + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
      enabled[next].click();
      enabled[next].focus();
    };
    parent.querySelector<HTMLButtonElement>('[data-remove-hood]')!.onclick = () =>
      this.change({ ...this.character, hat: null });
  }

  private value(slot: Slot): string {
    return slot === 'outfit' ? (this.character.top ?? 'base') : (this.character[slot] ?? '');
  }
  private variant(slot: Slot, value: string): Character {
    const result = { ...this.character };
    if (slot === 'outfit') {
      result.outfit = value === 'base' ? 'base' : value === 'dress_red' ? 'dress' : 'trousers';
      result.top = value === 'base' ? null : value;
      if (value === 'base' && result.hat === 'hood') result.hat = null;
    } else if (slot === 'proportion') {
      if (value) result.proportion = value as Character['proportion'];
      else delete result.proportion;
    } else if (slot === 'face') {
      result.face = value as Character['face'];
    } else if (slot === 'hair') {
      result.hair = value;
    } else {
      result[slot] = value || null;
    }
    return result;
  }

  setCharacter(character: Character): void {
    this.character = { ...character };
    const hiddenHair = character.hat === 'hood';
    this.parent.querySelector<HTMLButtonElement>('[data-slot="hair"]')!.disabled = hiddenHair;
    if (hiddenHair && this.slot === 'hair') this.slot = 'hat';
    for (const tab of this.parent.querySelectorAll<HTMLButtonElement>('[data-slot]'))
      tab.dataset.value = this.value(tab.dataset.slot as Slot);
    this.setSlot(this.slot);
    const colors = hairColorsFor(character);
    for (const button of this.parent.querySelectorAll<HTMLButtonElement>('[data-hair-color]'))
      button.style.setProperty('--swatch', colors[button.dataset.hairColor!]);
  }
  setDirection(direction: number): void {
    this.direction = direction;
    this.renderChoices();
  }

  setRoom(room: Pixels, spawn: Point, name: string): void {
    const cropWidth = Math.min(128, room.width);
    const cropHeight = Math.min(80, room.height);
    const cropX = Math.max(0, Math.min(room.width - cropWidth, Math.round(spawn.x - cropWidth / 2)));
    const cropY = Math.max(0, Math.min(room.height - cropHeight, Math.round(spawn.y - cropHeight * 0.58)));
    this.room = { spawn, cropX, cropY };
    this.roomBackground = document.createElement('canvas');
    this.roomBackground.width = cropWidth;
    this.roomBackground.height = cropHeight;
    const backgroundContext = this.roomBackground.getContext('2d');
    if (!backgroundContext) throw new Error('Die Raumprobe benötigt Canvas 2D.');
    const crop = new Uint8ClampedArray(cropWidth * cropHeight * 4);
    for (let y = 0; y < cropHeight; y++)
      for (let x = 0; x < cropWidth; x++) {
        const source = ((cropY + y) * room.width + cropX + x) * 4;
        crop.set(room.data.subarray(source, source + 4), (y * cropWidth + x) * 4);
      }
    paint(this.roomBackground, {
      width: cropWidth,
      height: cropHeight,
      data: crop,
    });
    this.roomBackground.getContext('2d')!.imageSmoothingEnabled = false;
    if (this.roomPreview) {
      this.roomPreview.width = cropWidth;
      this.roomPreview.height = cropHeight;
    }
    this.parent.querySelector<HTMLElement>('#editor-room-name')!.textContent = name;
  }

  drawRoom(sheet: HTMLCanvasElement, row: number, column: number): void {
    if (!this.room || !this.roomBackground || !this.roomPreview) return;
    const { spawn, cropX, cropY } = this.room;
    const context = this.roomPreview.getContext('2d');
    if (!context) throw new Error('Die Raumprobe benötigt Canvas 2D.');
    context.imageSmoothingEnabled = false;
    context.drawImage(this.roomBackground, 0, 0);
    const footX = Math.round(spawn.x - cropX);
    const footY = Math.round(spawn.y - cropY);
    context.drawImage(sheet, column * 32, row * 32, 32, 32, footX - 16, footY - 30, 32, 32);
  }

  private setSlot(slot: Slot): void {
    this.slot = slot;
    for (const tab of this.parent.querySelectorAll<HTMLButtonElement>('[data-slot]')) {
      const active = tab.dataset.slot === slot;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    this.options.setAttribute('aria-labelledby', `editor-tab-${slot}`);
    this.renderChoices();
  }
  private renderChoices(): void {
    if (!this.character) return;
    const focused = this.options.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.choice
      : undefined;
    const slot = slots.find((slot) => slot.id === this.slot)!;
    this.options.innerHTML = Object.entries(slot.choices)
      .map(
        ([value, name]) =>
          `<button class="avatar-choice" data-choice="${slot.id}:${value}" aria-pressed="${value === this.value(slot.id)}"><canvas width="72" height="72" aria-hidden="true"></canvas><span>${name}</span></button>`,
      )
      .join('');
    for (const button of this.options.querySelectorAll<HTMLButtonElement>('[data-choice]')) {
      const value = button.dataset.choice!.slice(slot.id.length + 1);
      const disabled = slot.id === 'hat' && value === 'hood' && this.character.outfit === 'base';
      button.disabled = disabled;
      if (disabled) {
        button.title = 'Für eine Kapuze zuerst Kleidung auswählen.';
        continue;
      }
      const config = this.variant(slot.id, value);
      const image = toCanvas(characterSheet(config));
      const ctx = button.querySelector('canvas')!.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      const detail = ['face', 'glasses', 'beard'].includes(slot.id);
      ctx.drawImage(
        image,
        detail ? 7 : 0,
        this.direction * 32 + (detail ? 8 : 0),
        detail ? 20 : 32,
        detail ? 20 : 32,
        detail ? 6 : 4,
        detail ? 6 : 4,
        detail ? 60 : 64,
        detail ? 60 : 64,
      );
      button.onclick = () => this.change(config);
      if (button.dataset.choice === focused) button.focus({ preventScroll: true });
    }
  }
}
