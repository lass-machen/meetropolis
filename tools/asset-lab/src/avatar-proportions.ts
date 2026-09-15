import { extraHatNames, extraBeardNames, extraHat, extraBeard } from './avatar-accessories.ts';
import type { Grid, SpriteCatalog, View } from '../../../packages/shared/src/sprite/types.ts';

import { applyCompactStyle } from './avatar-compact.ts';

export const proportions = {
  kompakt: {
    name: 'Kompakt',
    detail: 'Große Haarflächen, kräftige Kontur und kurze Beine.',
    headWidth: 14,
    headHeight: 12,
    headY: 6,
    bodyWidth: 10,
    bodyHeight: 7,
  },
  kompakt_weich: {
    name: 'Kompakt · Weich',
    detail: 'Weiche Wangen, schmale Schultern und dieselbe kurze Silhouette.',
    headWidth: 14,
    headHeight: 12,
    headY: 6,
    bodyWidth: 8,
    bodyHeight: 7,
  },
  kompakt_markant: {
    name: 'Kompakt · Markant',
    detail: 'Kantiger Kiefer und betonte Schultern im kompakten Stil.',
    headWidth: 14,
    headHeight: 12,
    headY: 6,
    bodyWidth: 11,
    bodyHeight: 7,
  },
  kompakt_kraeftig: {
    name: 'Kompakt · Kräftig',
    detail: 'Runde Wangen, breiter Körper und ein fester Stand.',
    headWidth: 14,
    headHeight: 12,
    headY: 6,
    bodyWidth: 12,
    bodyHeight: 7,
  },
  rund: {
    name: 'Rund',
    detail: 'Breiter Kopf, kurzer Körper, kompakte Beine.',
    headWidth: 14,
    headHeight: 11,
    headY: 7,
    bodyWidth: 12,
    bodyHeight: 6,
  },
  klassisch: {
    name: 'Klassisch',
    detail: 'Kleinerer Kopf und ausgewogene Körperlängen.',
    headWidth: 12,
    headHeight: 9,
    headY: 5,
    bodyWidth: 10,
    bodyHeight: 8,
  },
  schlank: {
    name: 'Schlank',
    detail: 'Schmaler Kopf, schmale Schultern, längere Beine.',
    headWidth: 10,
    headHeight: 8,
    headY: 4,
    bodyWidth: 8,
    bodyHeight: 9,
  },
} as const;
export type ProportionId = keyof typeof proportions;
type Shape = (typeof proportions)[ProportionId];

/** Farbschlüsselraster für den vorhandenen Composer: jeder Eintrag ist ein Pixel. */
class Raster {
  private rows = Array.from({ length: 32 }, () => Array<string>(32).fill('.'));
  rect(x: number, y: number, w: number, h: number, ink: string): this {
    if (w <= 0 || h <= 0) return this;
    if (x < 0 || y < 0 || x + w > 32 || y + h > 32)
      throw new Error('Ein Charakterteil überschreitet sein 32-Pixel-Raster.');
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) this.rows[py][px] = ink;
    return this;
  }
  round(x: number, y: number, w: number, h: number, ink: string, edge = 1): this {
    return this.rect(x + edge, y, w - edge * 2, h, ink).rect(x, y + edge, w, h - edge * 2, ink);
  }
  grid(): Grid {
    return this.rows.map((row) => row.join(''));
  }
}

function geometry(shape: Shape, view: View) {
  const side = view === 'side';
  const headW = shape.headWidth - (side ? 3 : 0);
  const bodyW = side ? Math.max(5, shape.bodyWidth - 4) : shape.bodyWidth;
  const headX = Math.floor((32 - headW) / 2);
  const bodyX = Math.floor((32 - bodyW) / 2);
  const bodyY = shape.headY + shape.headHeight;
  const eyeY = shape.headY + Math.floor(shape.headHeight * 0.6);
  return {
    headX,
    headW,
    bodyX,
    bodyW,
    bodyY,
    legY: bodyY + shape.bodyHeight - 1,
    eyeY,
    mouthY: shape.headY + shape.headHeight - 2,
  };
}

function head(shape: Shape, view: View): Grid {
  const { headX: x, headW: w, bodyY } = geometry(shape, view);
  const y = shape.headY;
  const h = shape.headHeight;
  const p = new Raster();
  p.rect(14, bodyY - 2, 4, 4, 'c').rect(15, bodyY - 1, 2, 3, 'b');
  if (view !== 'side')
    p.round(x - 1, y + Math.floor(h / 2), w + 2, 3, 'c').rect(x - 1, y + Math.floor(h / 2), 1, 2, 'b');
  for (let row = 0; row < h; row++) {
    const inset = row === 0 ? 2 : row === h - 1 ? 3 : row === h - 2 ? 2 : row === 1 || row === h - 3 ? 1 : 0;
    p.rect(x + inset, y + row, w - inset * 2, 1, 'c');
    if (row < h - 1) p.rect(x + inset + 1, y + row, w - inset * 2 - 2, 1, 'b');
  }
  p.rect(x + 2, y + 2, w - 5, 1, 'a');
  if (view === 'side')
    p.rect(x - 1, y + Math.floor(h * 0.6), 2, 2, 'b').rect(x + w - 3, y + Math.floor(h / 2), 2, 2, 'a');
  return p.grid();
}

function face(shape: Shape, view: View, expression: string): Grid {
  const { headX: x, headW: w, eyeY, mouthY } = geometry(shape, view);
  const p = new Raster();
  const eyes = view === 'side' ? [x + 1] : [x + 3, x + w - 4];
  for (const eye of eyes) {
    p.rect(eye, eyeY - 2, 1, 1, 'R');
    if (expression === 'wach') p.rect(eye, eyeY, 2, 2, 'E').rect(eye + 1, eyeY, 1, 1, 'W');
    else p.rect(eye, eyeY, 1, expression === 'ruhig' ? 2 : 1, 'E');
  }
  const mouthX = view === 'side' ? x : 15;
  if (expression === 'freundlich')
    p.rect(mouthX, mouthY - 1, view === 'side' ? 2 : 3, 1, 'M').rect(mouthX + 1, mouthY, 1, 1, 'M');
  else p.rect(mouthX, mouthY, 2, 1, 'M');
  return p.grid();
}

function hair(shape: Shape, view: View, style: string, covered: boolean): Grid {
  const { headX: x, headW: w, bodyY } = geometry(shape, view);
  const y = shape.headY;
  const p = new Raster();
  if (style === 'bald') return p.grid();
  const long = ['long', 'bob', 'braids'].includes(style);
  const bottom = view === 'rear' ? bodyY - 2 : y + 3;
  p.round(x - 1, y - 1, w + 2, bottom - y + 2, 'j', 2);
  p.round(x, y - 1, w, bottom - y + 1, 'i', 2);
  p.rect(x + 2, y, Math.max(2, w - 5), 1, 'h');
  if (view === 'front')
    p.rect(x - 1, y + 2, w + 2, 2, '.')
      .rect(x - 1, y + 1, 2, 4, 'j')
      .rect(x + w - 1, y + 1, 2, 3, 'j');
  if (view === 'side') p.round(x + Math.floor(w / 2), y + 1, Math.ceil(w / 2) + 1, shape.headHeight - 2, 'i', 1);
  if (style === 'buzz') {
    if (view !== 'rear') p.rect(x - 1, y + 2, w + 2, 2, '.');
    p.rect(x + 2, y, w - 4, 1, 'i');
  }
  if (style === 'messy' || style === 'spiky') {
    const high = style === 'spiky' ? 3 : 2;
    for (let dx = 1; dx < w - 1; dx += 3) p.rect(x + dx, y - high + (dx % 2), 2, 2, 'i');
    if (view !== 'rear')
      for (let dx = 1; dx < w - 1; dx += 4) p.rect(x + dx, y + 1, 2, 2, 'j').rect(x + dx, y + 1, 1, 1, 'i');
  }
  if (style === 'side_part') {
    p.rect(x + Math.floor(w * 0.65), y - 1, 1, 3, 'j');
    if (view !== 'rear') p.rect(x + 1, y + 2, Math.floor(w / 2), 1, 'i');
  }
  if (style === 'curly') {
    for (let dx = 0; dx < w; dx += 3)
      p.round(x + dx - 1, y - 2 + (dx % 2), 4, 4, 'j').rect(x + dx, y - 1 + (dx % 2), 2, 1, 'h');
    p.round(x - 1, y + 2, 3, 4, 'i').round(x + w - 2, y + 1, 3, 4, 'j');
  }
  if (long) {
    const length = style === 'bob' ? 3 : 6;
    if (view === 'rear')
      p.round(x, bodyY - 4, w, length + 4, 'j', 2)
        .rect(x + 2, bodyY - 4, w - 4, length + 2, 'i')
        .rect(x + 3, bodyY - 3, 1, length, 'h');
    else {
      if (view === 'front')
        p.rect(x - 1, y + 2, 2, shape.headHeight + length - 2, 'j').rect(
          x,
          y + 3,
          1,
          shape.headHeight + length - 4,
          'i',
        );
      p.rect(x + w - 1, y + 2, 2, shape.headHeight + length - 2, 'j').rect(
        x + w - 1,
        y + 3,
        1,
        shape.headHeight + length - 4,
        'i',
      );
    }
    if (style === 'braids')
      for (let dy = 3; dy < shape.headHeight + 6; dy += 3) {
        p.rect(x - 1, y + dy, 2, 1, 'h').rect(x + w - 1, y + dy, 2, 1, 'h');
      }
  }
  if (style === 'ponytail') {
    const tx = view === 'rear' ? x + w - 4 : x + w;
    p.round(tx, y + 3, 4, shape.headHeight + 1, 'j').rect(tx + 1, y + 3, 2, shape.headHeight - 1, 'i');
    p.rect(tx, y + 4, 3, 1, 'h');
  }
  if (style === 'bun')
    p.round(x + Math.floor(w / 2) - 2, y - 4, 5, 4, 'j').rect(x + Math.floor(w / 2) - 1, y - 3, 3, 1, 'h');
  // Geschlossene Hüte ersetzen nur die oberen Haare; seitliche Längen bleiben.
  if (covered) p.rect(0, 0, 32, y + 1, '.');
  return p.grid();
}

function torso(shape: Shape, view: View, mode: 'trousers' | 'dress' | 'base'): Grid {
  const { bodyX: x, bodyW: w, bodyY: y } = geometry(shape, view);
  const h = shape.bodyHeight;
  const p = new Raster();
  const shade = mode === 'base' ? 'c' : 'v';
  const mid = mode === 'base' ? 'b' : 'u';
  const light = mode === 'base' ? 'a' : 't';
  p.round(x - 1, y, w + 2, h, shade)
    .rect(x, y, w, h - 1, mid)
    .rect(x, y + 1, 1, h - 3, light);
  if (view !== 'side') p.rect(14, y, 4, 1, 'c').rect(15, y + 1, 2, 1, mid);
  if (mode === 'dress') {
    p.round(x - 2, y + h - 3, w + 4, 6, shade).rect(x - 1, y + h - 3, w + 2, 4, mid);
    p.rect(x + 1, y + h - 2, 1, 3, light);
  } else if (mode === 'trousers' && view === 'front') p.rect(x + w - 3, y + h - 3, 2, 1, light);
  return p.grid();
}

function frontLegs(shape: Shape, bare: boolean): Grid {
  const { bodyX: x, bodyW: w, legY: y } = geometry(shape, 'front');
  const p = new Raster();
  const legW = Math.max(2, Math.floor(w / 2) - 1);
  const mid = bare ? 'b' : 'p';
  const shade = bare ? 'c' : 'q';
  p.rect(x + 1, y, w - 2, 2, mid);
  for (const legX of [x + 1, x + w - legW - 1])
    p.rect(legX, y + 1, legW, 28 - y, mid).rect(legX + legW - 1, y + 1, 1, 28 - y, shade);
  return p.grid();
}

function sideLeg(shape: Shape, back: boolean, bare: boolean): Grid {
  const { bodyX: x, legY: y } = geometry(shape, 'side');
  return new Raster().rect(x + (back ? 2 : 0), y, 3, 29 - y, bare ? (back ? 'c' : 'b') : back ? 'q' : 'p').grid();
}

function shoe(shape: Shape, slot: string, bare: boolean): Grid {
  const side = slot.startsWith('side');
  const { bodyX, bodyW } = geometry(shape, side ? 'side' : 'front');
  const legW = Math.max(2, Math.floor(bodyW / 2) - 1);
  const x = side ? bodyX + (slot === 'side_back' ? 1 : -1) : slot === 'front_l' ? bodyX : bodyX + bodyW - legW - 1;
  const w = side ? 4 : legW + 1;
  return new Raster()
    .rect(x, 28, w, 2, bare ? 'c' : 'd')
    .rect(x, 28, w - 1, 1, bare ? 'b' : 'r')
    .grid();
}

function hand(shape: Shape, right: boolean): Grid {
  const { bodyX: x, bodyW: w, legY } = geometry(shape, 'front');
  return new Raster()
    .round(right ? x + w : x - 2, legY - 1, 2, 3, 'c')
    .rect(right ? x + w : x - 2, legY - 1, 1, 2, 'b')
    .grid();
}

function arm(shape: Shape, bare: boolean, short = false): Grid {
  const { bodyX: x, bodyW: w, bodyY: y, legY } = geometry(shape, 'side');
  const p = new Raster();
  const ax = x + Math.floor(w / 2);
  p.rect(ax, y + 1, 3, legY - y, bare ? 'c' : 'v').rect(ax, y + 1, 2, short ? 2 : legY - y - 1, bare ? 'b' : 'u');
  p.rect(ax, short ? y + 3 : legY - 1, 2, short ? legY - y - 1 : 3, 'b').rect(ax + 1, legY + 1, 1, 1, 'c');
  return p.grid();
}

function beard(shape: Shape, view: View, style: string): Grid {
  const { headX: x, headW: w, mouthY } = geometry(shape, view);
  const p = new Raster();
  const mx = view === 'side' ? x : 15;
  if (style === 'schnauzer') p.rect(mx - 1, mouthY - 1, view === 'side' ? 3 : 4, 1, 'f');
  if (style === 'ziegenbart') p.rect(mx, mouthY + 1, 2, 2, 'g').rect(mx, mouthY + 1, 1, 1, 'f');
  if (style === 'vollbart') {
    p.round(x, mouthY - 1, view === 'side' ? 5 : w, 4, 'g', 1).rect(x + 1, mouthY, view === 'side' ? 3 : w - 2, 2, 'f');
    p.rect(mx, mouthY, 2, 1, 'M');
  }
  return p.grid();
}

function glasses(shape: Shape, view: View, style: string): Grid {
  const { headX: x, headW: w, eyeY: y } = geometry(shape, view);
  const p = new Raster();
  const eyes = view === 'side' ? [x + 1] : [x + 3, x + w - 4];
  for (const eye of eyes) {
    if (style === 'round')
      p.rect(eye - 1, y, 1, 2, 'G')
        .rect(eye + 1, y, 1, 2, 'G')
        .rect(eye, y - 1, 1, 1, 'G')
        .rect(eye, y + 2, 1, 1, 'G');
    else
      p.rect(eye - 1, y - 1, 3, 1, 'G')
        .rect(eye - 1, y + 2, 3, 1, 'G')
        .rect(eye - 1, y, 1, 2, 'G')
        .rect(eye + 1, y, 1, 2, 'G');
    if (style === 'prof') p.rect(eye, y, 1, 1, '1');
  }
  if (view === 'side') p.rect(x + 3, y, w - 3, 1, 'G');
  else p.rect(x + 5, y, w - 10, 1, 'G');
  return p.grid();
}

function hat(shape: Shape, view: View, style: string): Grid {
  const { headX: x, headW: w } = geometry(shape, view);
  const y = shape.headY;
  const p = new Raster();
  if (style === 'cap' || style === 'bierhelm') {
    p.round(x - 1, y - 2, w + 2, 5, 'C', 2)
      .round(x, y - 2, w, 4, 'B', 1)
      .rect(x + 2, y - 1, w - 5, 1, 'A');
    p.rect(view === 'side' ? x - 4 : x - 2, y + 2, view === 'side' ? w : w + 4, 1, 'C');
    if (style === 'bierhelm') p.rect(x - 3, y - 1, 2, 4, 'U').rect(x + w + 1, y - 1, 2, 4, 'V');
  }
  if (style === 'cowboy') {
    p.round(x + 1, y - 3, w - 2, 5, 'I').rect(x + 2, y - 3, w - 4, 3, 'F');
    p.rect(x - 3, y + 1, w + 6, 2, 'H').rect(x - 2, y + 1, w + 4, 1, 'F');
  }
  if (style === 'zylinder') {
    p.rect(x + 1, y - 4, w - 2, 6, 'Q')
      .rect(x + 2, y - 4, 1, 4, 'P')
      .rect(x + 1, y, w - 2, 1, 'T');
    p.rect(x - 2, y + 2, w + 4, 1, 'Q');
  }
  if (style === 'krone' || style === 'diadem') {
    p.rect(x, y + 1, w, 2, 'N').rect(x, y + 1, w, 1, 'K');
    const peaks = style === 'krone' ? [x, x + Math.floor(w / 2), x + w - 2] : [x + Math.floor(w / 2)];
    for (const px of peaks) p.rect(px, y - 2, 2, 3, 'K').rect(px, y - 2, 1, 1, 'Y');
  }
  return p.grid();
}

function hood(shape: Shape, view: View): Grid {
  const { headX: x, headW: w, bodyY } = geometry(shape, view);
  const y = shape.headY;
  const p = new Raster()
    .round(x - 2, y - 2, w + 4, shape.headHeight + 4, 'v', 3)
    .round(x - 1, y - 2, w + 2, shape.headHeight + 2, 'u', 2);
  p.rect(x + 1, y - 1, w - 4, 1, 't');
  if (view === 'front') p.round(x + 1, y + 2, w - 2, shape.headHeight - 2, '.', 1);
  if (view === 'side') p.rect(x - 1, y + 2, Math.ceil(w / 2) + 1, shape.headHeight - 2, '.');
  p.rect(x + 2, bodyY + 1, w - 4, 1, 'v');
  return p.grid();
}

function misc(shape: Shape, view: View, style: string): Grid {
  const { headX: x, bodyY, mouthY } = geometry(shape, view);
  const p = new Raster();
  if (view === 'rear') return p.grid();
  const mx = view === 'side' ? x : 15;
  if (style === 'schnuller') p.round(mx - 1, mouthY - 1, 4, 3, '4').rect(mx, mouthY - 1, 2, 1, '3');
  if (style === 'zigarette') p.rect(mx - 3, mouthY, 4, 1, '6').rect(mx - 3, mouthY, 1, 1, '7');
  if (style === 'kette')
    p.rect(view === 'side' ? 13 : 14, bodyY + 2, view === 'side' ? 2 : 4, 1, 'K').rect(15, bodyY + 3, 1, 1, 'L');
  return p.grid();
}

/** Neue Teile behalten den Sheet- und Animationsvertrag des gemeinsamen Composers. */
export function createProportionCatalog(base: SpriteCatalog, id: ProportionId, covered: boolean): SpriteCatalog {
  const catalog = structuredClone(base);
  const shape = proportions[id];
  const compact = id.startsWith('kompakt');
  const put = (path: string, grid: Grid): void => {
    const parts = path.split('.');
    let node = catalog.catalogs;
    for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Record<string, unknown>;
    node[parts.at(-1)!] = grid;
  };
  for (const view of ['front', 'side', 'rear'] as const) {
    const { headX, headW, mouthY } = geometry(shape, view);
    const accessoryHead = compact
      ? undefined
      : {
          headX,
          headWidth: headW,
          headY: shape.headY,
          headHeight: shape.headHeight,
          mouthX: view === 'side' ? headX : 15,
          mouthY,
        };
    put(`bodies.body.${view}`, head(shape, view));
    for (const mode of ['trousers', 'dress'] as const) put(`tops.${mode}.${view}`, torso(shape, view, mode));
    put(`bodies.torso_bare.${view}`, torso(shape, view, 'base'));
    for (const name of Object.keys(catalog.catalogs.hairstyles as object))
      put(`hairstyles.${name}.${view}`, hair(shape, view, name, covered));
    for (const name of Object.keys(catalog.catalogs.hats as object))
      put(
        `hats.${name}.${view}`,
        Object.hasOwn(extraHatNames, name) ? extraHat(view, name, accessoryHead) : hat(shape, view, name),
      );
    for (const name of Object.keys(catalog.catalogs.misc as object))
      put(`misc.${name}.${view}`, misc(shape, view, name));
    put(`hood.${view}`, hood(shape, view));
    if (view === 'rear') continue;
    for (const name of ['ruhig', 'freundlich', 'wach']) put(`lab_faces.${name}.${view}`, face(shape, view, name));
    for (const name of Object.keys(catalog.catalogs.beards as object))
      put(
        `beards.${name}.${view}`,
        Object.hasOwn(extraBeardNames, name) ? extraBeard(view, name, accessoryHead) : beard(shape, view, name),
      );
    for (const name of Object.keys(catalog.catalogs.glasses as object))
      put(`glasses.${name}.${view}`, glasses(shape, view, name));
  }
  put('bottoms.trousers.front', frontLegs(shape, false));
  put('bottoms.trousers.side', new Raster().grid());
  for (const mode of ['full', 'dress']) {
    put(`bodies.legs_bare_${mode}.front`, frontLegs(shape, true));
    put(`bodies.legs_bare_${mode}.side_front`, sideLeg(shape, false, true));
    put(`bodies.legs_bare_${mode}.side_back`, sideLeg(shape, true, true));
  }
  put('bottoms.legs_side.front', sideLeg(shape, false, false));
  put('bottoms.legs_side.back', sideLeg(shape, true, false));
  for (const slot of ['front_l', 'front_r', 'side_front', 'side_back']) {
    put(`bottoms.shoes.${slot}`, shoe(shape, slot, false));
    put(`bodies.feet_bare.${slot}`, shoe(shape, slot, true));
  }
  put('tops.hands.front_l', hand(shape, false));
  put('tops.hands.front_r', hand(shape, true));
  put('tops.arms.side', arm(shape, false));
  put('tops.arms.side_short', arm(shape, false, true));
  put('bodies.arm_bare_side', arm(shape, true));
  const { bodyX, bodyW, legY } = geometry(shape, 'front');
  put('bodies.underwear.front', new Raster().rect(bodyX + 1, legY, bodyW - 2, 2, 'w').grid());
  const side = geometry(shape, 'side');
  put('bodies.underwear.side', new Raster().rect(side.bodyX, side.legY, side.bodyW, 2, 'w').grid());
  return id.startsWith('kompakt') ? applyCompactStyle(catalog, covered, id) : catalog;
}
