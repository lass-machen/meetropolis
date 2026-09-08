import { buildAssets } from '../src/assets.ts';
import { characterSheet, defaultCharacter } from '../src/avatar.ts';
import { paint } from '../src/canvas.ts';
import { Pixels } from '../src/pixels.ts';
import { officePresets } from '../src/office-presets.ts';
import { roomSprites } from '../src/world.ts';

const character = characterSheet({
  ...defaultCharacter,
  proportion: 'kompakt',
  hair_color: 'blond',
});
const frame = (row: number): Pixels => {
  const p = new Pixels(32, 32);
  for (let y = 0; y < 32; y++)
    p.data.set(character.data.subarray((row * 32 + y) * 128 * 4, ((row * 32 + y) * 128 + 32) * 4), y * 32 * 4);
  return p;
};
const show = (id: string, pixels: Pixels) => paint(document.querySelector<HTMLCanvasElement>(`#${id}`)!, pixels);
show('face', frame(0));
const assets = buildAssets('abend');
const wallAssets = buildAssets('holz');
const wallStudy = new Pixels(112, 96);
wallStudy.rect(0, 0, 112, 96, '#e7eede');
const walls = [
  { x: 16, y: 32 },
  { x: 16, y: 48 },
  { x: 16, y: 64 },
  { x: 16, y: 80 },
  { x: 64, y: 32 },
  { x: 64, y: 48 },
  { x: 64, y: 64 },
  { x: 80, y: 64 },
  { x: 96, y: 64 },
];
for (const item of roomSprites({ ...officePresets.loft, placements: [], walls }, wallAssets))
  wallStudy.stamp(item.pixels, item.x, item.y);
show('walls', wallStudy);

function scaleStudy(desk: Pixels, chair: Pixels): Pixels {
  const image = new Pixels(160, 112);
  for (let y = 0; y < 112; y += 16) for (let x = 0; x < 160; x += 16) image.stamp(assets.carpet, x, y);
  image.stamp(desk, 68, 56 - desk.height);
  image.stamp(chair, 68 + Math.floor((desk.width - chair.width) / 2), 94 - chair.height);
  image.stamp(frame(3), 30, 26);
  image.stamp(frame(0), 20, 66);
  return image;
}
show('old-scale', scaleStudy(assets.desk, assets.chair_north));
show('new-scale', scaleStudy(assets.compact_desk, assets.compact_chair_north));
