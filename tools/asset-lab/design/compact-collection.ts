import {
  characterSheet,
  defaultCharacter,
  compactLooks,
  extraHatNames,
  extraBeardNames,
  type Character,
} from '../src/avatar.ts';
import { buildAssets, assetDefinitions, type AssetId } from '../src/assets.ts';
import { paint, toCanvas } from '../src/canvas.ts';
import { Pixels } from '../src/pixels.ts';
import { roomSprites } from '../src/world.ts';
import { officePresets } from '../src/office-presets.ts';

const base: Character = {
  ...defaultCharacter,
  proportion: 'kompakt',
  hair_color: 'blond',
};
const models: {
  sheet: HTMLCanvasElement;
  front: HTMLCanvasElement;
  views?: HTMLCanvasElement;
}[] = [];
function card(parent: string, title: string): HTMLElement {
  const article = document.createElement('article');
  article.className = 'card';
  const heading = document.createElement('strong');
  heading.textContent = title;
  article.append(heading);
  document.getElementById(parent)!.append(article);
  return article;
}
function figure(parent: string, title: string, character: Character, views = true) {
  const article = card(parent, title),
    front = document.createElement('canvas');
  front.width = 32;
  front.height = 32;
  front.className = 'figure';
  article.append(front);
  const strip = views ? document.createElement('canvas') : undefined;
  if (strip) {
    strip.width = 128;
    strip.height = 32;
    strip.className = 'views';
    article.append(strip);
  }
  models.push({
    sheet: toCanvas(characterSheet(character)),
    front,
    views: strip,
  });
}
for (const [proportion, title] of [
  ['kompakt', 'Vertraut'],
  ['kompakt_weich', 'Weich'],
  ['kompakt_markant', 'Markant'],
  ['kompakt_kraeftig', 'Kräftig'],
] as const)
  figure('bodies', title, {
    ...base,
    proportion,
    hair: 'buzz',
    top: 'shirt_white',
  });
for (const id of ['studio', 'atelier', 'business', 'weekend']) {
  const look = compactLooks[id];
  figure('looks', look.name, { ...base, ...look.character });
}
for (const [hat, name] of Object.entries(extraHatNames))
  figure('hats', name, { ...base, hat, hair: 'bob', hair_color: 'braun' }, false);
for (const [beard, name] of Object.entries(extraBeardNames))
  figure('beards', name, {
    ...base,
    beard,
    beard_color: 'braun',
    top: 'suit_navy',
  });
const assets = buildAssets('holz');
for (const id of [
  'compact_desk',
  'compact_chair_north',
  'compact_sofa',
  'compact_counter',
  'drawer',
  'cabinet',
  'armchair',
  'round_table',
  'printer',
  'coat_stand',
  'water_cooler',
  'pinboard',
] as AssetId[]) {
  const article = card('furniture', assetDefinitions[id].name);
  const canvas = document.createElement('canvas');
  canvas.className = 'object';
  const p = new Pixels(96, 64);
  p.stamp(assets[id], 48 - Math.floor(assets[id].width / 2), 60 - assets[id].height);
  paint(canvas, p);
  article.append(canvas);
}
const shapes = [
  {
    name: 'L-Ecken',
    points: [
      [16, 32],
      [16, 48],
      [16, 64],
      [32, 64],
      [48, 64],
      [80, 32],
      [96, 32],
      [112, 32],
      [112, 48],
      [112, 64],
    ],
  },
  {
    name: 'T- und Kreuzanschlüsse',
    points: [
      [16, 32],
      [16, 48],
      [16, 64],
      [0, 48],
      [32, 48],
      [80, 32],
      [80, 48],
      [80, 64],
      [64, 48],
      [96, 48],
    ],
  },
];
for (const shape of shapes) {
  const article = card('walls', shape.name);
  article.classList.add('wide');
  const p = new Pixels(144, 96);
  p.rect(0, 0, 144, 96, '#f1f4ec');
  for (const item of roomSprites(
    {
      ...officePresets.loft,
      placements: [],
      walls: shape.points.map(([x, y]) => ({ x, y })),
    },
    assets,
  ))
    p.stamp(item.pixels, item.x, item.y);
  const canvas = document.createElement('canvas');
  canvas.className = 'wall';
  paint(canvas, p);
  article.append(canvas);
}
let walking = false;
const button = document.querySelector<HTMLButtonElement>('#animate')!;
button.onclick = () => {
  walking = !walking;
  button.setAttribute('aria-pressed', String(walking));
  button.textContent = walking ? 'Anhalten' : 'Laufen ansehen';
};
function draw(time: number) {
  const col = walking ? Math.floor(time / 125) % 4 : 0,
    row = walking ? 4 : 0;
  for (const model of models) {
    const ctx = model.front.getContext('2d')!;
    ctx.clearRect(0, 0, 32, 32);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(model.sheet, col * 32, row * 32, 32, 32, 0, 0, 32, 32);
    if (model.views) {
      const c = model.views.getContext('2d')!;
      c.clearRect(0, 0, 128, 32);
      c.imageSmoothingEnabled = false;
      for (let dir = 0; dir < 4; dir++)
        c.drawImage(model.sheet, col * 32, (row + dir) * 32, 32, 32, dir * 32, 0, 32, 32);
    }
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
