import { characterSheet, compactLooks, proportions, type Character, type ProportionId } from './avatar.ts';
import { toCanvas } from './canvas.ts';
import { Pixels } from './pixels.ts';
import type { OfficePreset } from './office-model.ts';

/** Derselbe Animationsframe erscheint vergrößert und mit Möbeln bei Spielgröße. */
export function drawComparison(
  canvas: HTMLCanvasElement,
  sheet: HTMLCanvasElement,
  office: HTMLCanvasElement,
  direction: number,
  frame: number,
  walking: boolean,
): void {
  const ctx = canvas.getContext('2d')!;
  const row = direction + (walking ? 4 : 0);
  const column = walking ? frame : 0;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#f2f5ef';
  ctx.fillRect(0, 0, 240, 304);
  ctx.fillStyle = '#dbe3d6';
  ctx.beginPath();
  ctx.ellipse(120, 126, 36, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(sheet, column * 32, row * 32, 32, 32, 56, 4, 128, 128);
  ctx.drawImage(office, 0, 0, 224, 144, 8, 150, 224, 144);
  ctx.fillStyle = '#35483e33';
  ctx.beginPath();
  ctx.ellipse(100, 268, 9, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(sheet, column * 32, row * 32, 32, 32, 84, 238, 32, 32);
}

export const comparisonForms: ProportionId[] = ['kompakt'];

export class AvatarComparison {
  private office!: HTMLCanvasElement;
  private sheets = new Map<ProportionId, HTMLCanvasElement>();
  private views: { id: ProportionId; canvas: HTMLCanvasElement }[];

  constructor(parent: HTMLElement, select: (appearance: Partial<Character>) => void) {
    parent.innerHTML = `<div class="comparison-heading"><div><h2>Kompakt und mit Kontur</h2><p>Die feste Körperform vergrößert und im Büroausschnitt.</p></div><button class="secondary small" id="export-comparison">Vorschau als PNG ↓</button></div>
      <div class="comparison-looks" role="group" aria-label="Beispiele der neuen Stilprobe"><span>Neue Figur ausprobieren</span>${Object.entries(
        compactLooks,
      )
        .map(([id, look]) => `<button class="secondary small" data-look="${id}">${look.name}</button>`)
        .join('')}</div>
      <div class="comparison-cards">${comparisonForms
        .map((id) => [id, proportions[id]] as const)
        .map(
          ([id, p]) =>
            `<article><h3>${p.name}</h3><p>${p.detail}</p><canvas width="240" height="304" data-comparison="${id}" aria-label="${p.name}: animierte Figur und Büroausschnitt"></canvas></article>`,
        )
        .join('')}</div>
      <div class="comparison-footer"><p>Haut, Gesicht, Haare und Kleidung bleiben anpassbar. Die Pfeile an der Figur zeigen alle vier Blickrichtungen.</p></div>`;
    this.views = [...parent.querySelectorAll<HTMLCanvasElement>('[data-comparison]')].map((canvas) => ({
      id: canvas.dataset.comparison as ProportionId,
      canvas,
    }));
    for (const button of parent.querySelectorAll<HTMLButtonElement>('[data-look]'))
      button.onclick = () => select(compactLooks[button.dataset.look!].character);
  }

  setCharacter(character: Character): void {
    for (const id of Object.keys(proportions) as ProportionId[])
      this.sheets.set(id, toCanvas(characterSheet({ ...character, proportion: id })));
  }

  setRoom(room: Pixels, preset: OfficePreset): void {
    const crop = new Pixels(224, 144);
    crop.stamp(room, 92 - preset.spawn.x, 118 - preset.spawn.y);
    this.office = toCanvas(crop);
  }

  render(direction: number, frame: number, walking: boolean): void {
    for (const view of this.views)
      drawComparison(view.canvas, this.sheets.get(view.id)!, this.office, direction, frame, walking);
  }

  exportImage(direction: number, frame: number, walking: boolean): HTMLCanvasElement {
    this.render(direction, frame, walking);
    const output = document.createElement('canvas');
    output.width = 768;
    output.height = 390;
    const ctx = output.getContext('2d')!;
    ctx.fillStyle = '#f2f5ef';
    ctx.fillRect(0, 0, output.width, output.height);
    ctx.fillStyle = '#354b3d';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('Meetropolis · Neue Avatar-Stilprobe', 16, 26);
    this.views.forEach((view, i) => {
      ctx.fillStyle = '#354b3d';
      ctx.font = '14px sans-serif';
      ctx.fillText(proportions[view.id].name, 16 + i * 256, 58);
      ctx.drawImage(view.canvas, 8 + i * 256, 72);
    });
    return output;
  }
}
