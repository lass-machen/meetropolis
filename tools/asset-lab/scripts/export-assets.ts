import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { buildAssets, themes, type ThemeId } from '../src/assets.ts';
import { packConfig, packZip, officeRecipe } from '../src/pack.ts';
import { roomImage } from '../src/world.ts';
import { officeList } from '../src/office-presets.ts';

const output = fileURLToPath(new URL('../exports/', import.meta.url));
await mkdir(output, { recursive: true });
await writeFile(`${output}/LICENSE.txt`, await readFile(new URL('../LICENSE', import.meta.url)));
for (const theme of Object.keys(themes) as ThemeId[]) {
  const assets = buildAssets(theme);
  const directory = `${output}/${theme}`;
  await mkdir(`${directory}/assets`, { recursive: true });
  const encode = (p: { width: number; height: number; data: Uint8ClampedArray }): Buffer => {
    const image = new PNG({ width: p.width, height: p.height });
    image.data = Buffer.from(p.data);
    return PNG.sync.write(image);
  };
  for (const [id, pixels] of Object.entries(assets)) await writeFile(`${directory}/assets/${id}.png`, encode(pixels));
  await writeFile(`${directory}/config.json`, JSON.stringify(packConfig(theme, assets), null, 2));
  for (const office of officeList) {
    await writeFile(`${directory}/${office.id}.png`, encode(roomImage(theme, assets, office)));
    await writeFile(
      `${directory}/${office.id}.json`,
      JSON.stringify(officeRecipe({ theme, office: office.id }), null, 2),
    );
  }
  await writeFile(`${output}/atelier-${theme}.mepack`, await packZip(theme, assets, (id) => encode(assets[id])));
  console.log(`${themes[theme].name}: ${Object.keys(assets).length} PNGs und .mepack → ${directory}`);
}
