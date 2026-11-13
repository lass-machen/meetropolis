// Quiet sheet template: system font, neutral surfaces, no gradients,
// no external resources. Every sprite renders at integer scales with
// image-rendering: pixelated.

import type { FigureRecipe } from './figures.ts';
import { DIRECTIONS, DIRECTION_LABELS } from './figures.ts';
import { SKIN_TONES } from './palette.ts';

export interface SheetModel {
  figures: FigureRecipe[];
  pngPath: (name: string) => string;
  generatedAt: string;
}

function pairCell(model: SheetModel, figure: FigureRecipe, dir: string): string {
  const label = DIRECTION_LABELS[dir as keyof typeof DIRECTION_LABELS];
  const before = model.pngPath(`${figure.id}_${dir}_before.png`);
  const after = model.pngPath(`${figure.id}_${dir}_after.png`);
  return (
    `<div class="cell"><p class="tag">${label}</p>` +
    `<div class="pair"><figure><img src="${before}" width="128" height="128" alt="${figure.id} ${label} vorher"><figcaption>vorher</figcaption></figure>` +
    `<figure><img src="${after}" width="128" height="128" alt="${figure.id} ${label} nachher"><figcaption>nachher</figcaption></figure></div></div>`
  );
}

function smallRows(model: SheetModel, figure: FigureRecipe, scale: number, bg: string): string {
  const size = 32 * scale;
  const glyph = scale === 1 ? '1×' : '2×';
  const cells = DIRECTIONS.map((dir) => {
    const before = model.pngPath(`${figure.id}_${dir}_before.png`);
    const after = model.pngPath(`${figure.id}_${dir}_after.png`);
    return (
      `<span class="mini"><img src="${before}" width="${size}" height="${size}" alt="">` +
      `<img src="${after}" width="${size}" height="${size}" alt=""></span>`
    );
  }).join('');
  return (
    `<div class="minis ${bg}"><span class="minilabel">${glyph}</span>${cells}</div>` +
    `<p class="legend">Je Paar: vorher · nachher; Reihenfolge: vorne · links · rechts · hinten.</p>`
  );
}

function figureSection(model: SheetModel, figure: FigureRecipe, index: number, bg: string, bgLabel: string): string {
  const cells = DIRECTIONS.map((dir) => pairCell(model, figure, dir)).join('');
  return (
    `<section class="sheet ${bg}"><h3>Figur ${index + 1} · ${figure.label} · ${bgLabel}</h3>` +
    `<div class="grid">${cells}</div>` +
    `${smallRows(model, figure, 1, bg)}${smallRows(model, figure, 2, bg)}</section>`
  );
}

function skinRow(model: SheetModel): string {
  const swatches = SKIN_TONES.map((tone) => {
    const mark = tone.isNew ? ' <span class="neu">neu</span>' : '';
    const bars = tone.ramp
      .map((hex) => `<span class="bar" style="background:${hex}"></span>`)
      .join('');
    return `<div class="tone"><div class="ramp">${bars}</div><span>${tone.tone}${mark}</span><code>${tone.ramp.join(' ')}</code></div>`;
  }).join('');
  const img = model.pngPath('skin_row.png');
  return (
    `<section class="panel"><h2>Hautton-Farbreihe</h2>` +
    `<p>Four existing tones on the figures, four more only in the series. No productive kit expansion.</p>` +
    `<img class="strip" src="${img}" alt="Acht Hautton-Rampen">` +
    `<div class="tones">${swatches}</div></section>`
  );
}

function scaleSection(model: SheetModel): string {
  const img = model.pngPath('scale_strip.png');
  return (
    `<section class="panel"><h2>Scale · 1 sprite pixel = 1 world pixel</h2>` +
    `<img class="strip" src="${img}" alt="Scale strip with figure, desk and chair">` +
    `<ul><li>16px world grid, standing line as signature, all three on the same baseline.</li>` +
    `<li>Figure: after grid, front view, 32x32 (figure 1).</li>` +
    `<li>Desk: tools/asset-lab/src/assets.ts (desk), 64x48, theme holz.</li>` +
    `<li>Chair: tools/asset-lab/src/assets.ts (chair), 24x32, theme holz.</li>` +
    `<li>No new furniture drawn; only approved existing office pixels.</li></ul></section>`
  );
}

export function buildHtml(model: SheetModel): string {
  const light = model.figures.map((f, i) => figureSection(model, f, i, 'light', 'hell')).join('');
  const dark = model.figures.map((f, i) => figureSection(model, f, i, 'dark', 'dunkel')).join('');
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pixel studio style direction: draft proposal</title>
<style>
:root { color-scheme: light dark; }
body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: #f7f4ee; color: #1f1b16; line-height: 1.5; }
.wrap { max-width: 1160px; margin: 0 auto; padding: 32px 24px 64px; }
header { margin-bottom: 32px; }
header .draft { display: inline-block; border: 1px solid #8a847a; border-radius: 6px; padding: 2px 10px; font-size: 13px; }
h1 { font-size: 30px; font-weight: 500; margin: 12px 0 8px; }
h2 { font-size: 20px; font-weight: 500; margin: 0 0 8px; }
h3 { font-size: 16px; font-weight: 500; margin: 0 0 12px; }
.sub { color: #5e554a; max-width: 60ch; }
.sheet { border: 1px solid #d8d2c4; border-radius: 12px; padding: 20px; margin: 0 0 24px; }
.sheet.dark { background: #141415; color: #ededed; border-color: #2a2a2c; }
.sheet.dark .tag, .sheet.dark figcaption, .sheet.dark .minilabel, .sheet.dark .legend { color: #a1a1a6; }
.legend { font-size: 12px; color: #5e554a; margin: 8px 0 0; }
.sheet.light { background: #fdfbf7; }
.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
@media (min-width: 1240px) { .grid { grid-template-columns: repeat(4, 1fr); } }
.cell { text-align: center; }
.tag { font-size: 13px; color: #5e554a; margin: 0 0 8px; }
.pair { display: flex; gap: 12px; justify-content: center; }
figure { margin: 0; }
figcaption { font-size: 12px; color: #5e554a; margin-top: 4px; }
img { image-rendering: pixelated; }
.minis { display: flex; gap: 16px; align-items: center; margin-top: 16px; flex-wrap: wrap; }
.minilabel { font-size: 12px; color: #5e554a; width: 24px; }
.mini { display: inline-flex; gap: 8px; }
.panel { border: 1px solid #d8d2c4; border-radius: 12px; padding: 20px; margin: 0 0 24px; background: #fdfbf7; }
.strip { image-rendering: pixelated; max-width: 100%; border: 1px solid #d8d2c4; }
.tones { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 12px; }
.tone { font-size: 13px; }
.ramp { display: flex; }
.bar { width: 32px; height: 24px; display: inline-block; }
.tone code { display: block; font-size: 11px; color: #5e554a; margin-top: 4px; }
.neu { border: 1px solid #8a847a; border-radius: 4px; padding: 0 6px; font-size: 11px; }
footer { color: #5e554a; font-size: 13px; margin-top: 32px; }
footer code { font-size: 12px; }
@media (max-width: 640px) { .grid { grid-template-columns: 1fr; } .tones { grid-template-columns: repeat(2, 1fr); } }
</style>
</head>
<body><div class="wrap">
<header><span class="draft">Style proposal: production catalog unchanged</span>
<h1>Calm figures for the virtual office</h1>
<p class="sub">Four figures, four directions each, before and after. Static directions without walk or breathing frames, hand-set pixels.</p>
<p class="sub">Head 12 px, body with neck 14 px, 26 px in total. Less outline mass, clear faces and light from the top left. Clothing and hair colors stay the same in the comparison.</p></header>
<h2>Hell</h2>
${light}
<h2>Dunkel</h2>
${dark}
${skinRow(model)}
${scaleSection(model)}
<footer><p>Draft proposal, as of ${model.generatedAt}. Production catalog unchanged. Sources and structure are in the README in the study folder.</p></footer>
</div></body>
</html>
`;
}
