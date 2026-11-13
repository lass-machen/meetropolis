# Pixel studio style direction: draft proposal

Draft for calm avatar figures in the virtual office. Pure static
Draft: the production catalog (`packages/shared/sprite/catalog.json`) and
the product sprites remain unchanged.

## Bauen

Vom Worktree-Root:

```sh
node --experimental-strip-types tools/asset-lab/style-study/generate.ts --preview-dir /tmp/meetropolis-style-preview
```

`--preview-dir` points to any local target folder. The command
writes only `style.html` and `out/style/*.png` below it. Both remain
local (gitignored) and never committed. The command checks during the build
the acceptance check: 4 figures × 4 views, 32×32 grid, valid palette and
Symbole, deckende Pixel nur in y4…y29, echte Oberkante y4, getrennte
soles front/back, floor pixels in y29, no clipped pixels, plus
the baseline in the scale strip without a gap. On errors it ends with
Exit-Code 1.

The only prerequisite is Node 24.9. `pngjs` and `tsx` come from already
existing `node_modules`, nothing is installed: the generator
resolves `tsx` relative to the script and repo structure (first
`tools/asset-lab/style-study/node_modules/.bin/tsx` via the documented
gitignored Symlink, dann `node_modules/.bin/tsx` am Repo-Root, sonst `tsx`
from PATH). `tsx` only renders the before frames with the unchanged
shared composer; all checks and all after grids run under plain
Node.

## Richtung

- Product: style decision for avatars in the virtual office.
- Charakter: ruhig, liebevoll, leicht verspielt.
- World: pixel atelier, warm paper, calm surfaces, craft on the grid.
- Moments: the figures themselves and their scale next to real furniture.
- Signature: the fixed baseline in the scale strip.

## Rezepte

Vier feste Rezepte, alle mit Hose, Kapuzenpulli blau, dunkler Hose,
brown shoes and a calm face:

1. Figur 1: helle Haut, Seitenscheitel, braun
2. Figur 2: mittlere Haut, Bob, rot
3. Figure 3: tinted skin (tan), curls, black
4. Figur 4: dunkle Haut, Pferdeschwanz, schwarz

Each figure is shown from front, left, right and back, each before
and after.

## Before and after

Vorher (`before.ts`): echte Geometrie aus dem Shared-Composer des
unchanged catalog (static idle start frames from column 0,
rows 0…3). No legacy Python graphics.

Nachher (`grids/` + `figures.ts`): neue handgesetzte Quellraster aus
body (`body.ts`), face (`face.ts`) and four new hairstyle grids
(`hair-*.ts`). Die Rastersyntax nutzt einzelne Buchstabensymbole, die
`palette.ts` Farben zuordnet.

Gestaltung: 32×32-Canvas, Figur in y4…y29, Bodenlinie y30, Mitte x15.5.
Little heavy outline, readable short body, 2px tall dark eyes,
small mouth, small profile noses, no face pixels at the back. One
light source from the top left, also in the right profile. Three coordinated
values per material, contiguous areas, no dithering.

## Color series and scale

The eight skin tones come from the local preview
`knowledge/quality/asset/preview` (Datei `build.ts`, `SKIN_TONES`):
light, medium, tinted and dark as existing tones on the figures; fair,
olive, deep and deepest only as a color series.

The scale strip shows the 16px world grid, figure and two unchanged
existing furniture (desk 64×48, chair 24×32, both wood theme from
`tools/asset-lab/src/assets.ts`). Es gilt 1 Spritepixel = 1 Weltpixel.
