# Pixel studio style direction: draft proposal

Draft for calm avatar figures in the virtual office. Pure static
Draft: the production catalog (`packages/shared/sprite/catalog.json`) and
the product sprites remain unchanged.

## Build

From the worktree root:

```sh
node --experimental-strip-types tools/asset-lab/style-study/generate.ts --preview-dir /tmp/meetropolis-style-preview
```

`--preview-dir` points to any local target folder. The command
writes only `style.html` and `out/style/*.png` below it. Both remain
local (gitignored) and never committed. During the build, the command runs
the acceptance check: 4 figures × 4 views, 32×32 grid, valid palette and
symbols, opaque pixels only in y4…y29, real top edge at y4, separate
soles front/back, floor pixels in y29, no clipped pixels, plus
the baseline in the scale strip without a gap. On errors it ends with
exit code 1.

The only prerequisite is Node 24.9. `pngjs` and `tsx` come from already
existing `node_modules`, nothing is installed: the generator
resolves `tsx` relative to the script and repo structure (first
`tools/asset-lab/style-study/node_modules/.bin/tsx` via the documented
gitignored symlink, then `node_modules/.bin/tsx` at the repo root, otherwise `tsx`
from PATH). `tsx` only renders the before frames with the unchanged
shared composer; all checks and all after grids run under plain
Node.

## Direction

- Product: style decision for avatars in the virtual office.
- Character: calm, lovingly crafted, slightly playful.
- World: pixel atelier, warm paper, calm surfaces, craft on the grid.
- Moments: the figures themselves and their scale next to real furniture.
- Signature: the fixed baseline in the scale strip.

## Recipes

Four fixed recipes, all with trousers, blue hoodie, dark trousers,
brown shoes and a calm face:

1. Figure 1: light skin, side part, brown
2. Figure 2: medium skin, bob, red
3. Figure 3: tinted skin (tan), curls, black
4. Figure 4: dark skin, ponytail, black

Each figure is shown from front, left, right and back, each before
and after.

## Before and after

Before (`before.ts`): real geometry from the shared composer of the
unchanged catalog (static idle start frames from column 0,
rows 0…3). No legacy Python graphics.

After (`grids/` + `figures.ts`): new hand-placed source grids from
body (`body.ts`), face (`face.ts`) and four new hairstyle grids
(`hair-*.ts`). The grid syntax uses single letter symbols, which
`palette.ts` maps to colors.

Design: 32×32 canvas, figure in y4…y29, ground line y30, center x15.5.
A slightly heavy outline, readable short body, 2px tall dark eyes,
small mouth, small profile noses, no face pixels at the back. One
light source from the top left, also in the right profile. Three coordinated
values per material, contiguous areas, no dithering.

## Color series and scale

The eight skin tones come from the local preview
`knowledge/quality/asset/preview` (file `build.ts`, `SKIN_TONES`):
light, medium, tinted and dark as existing tones on the figures; fair,
olive, deep and deepest only as a color series.

The scale strip shows the 16px world grid, figure and two unchanged
existing furniture pieces (desk 64×48, chair 24×32, both wood theme from
`tools/asset-lab/src/assets.ts`). The rule is 1 sprite pixel = 1 world pixel.
