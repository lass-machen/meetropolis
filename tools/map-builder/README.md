# Map builder

Deterministic Python tooling that stitches the OSS pixel-art assets
shipped under `apps/web/public/assets/` into the three derived tilesheets
plus the Tiled JSON map (`office.json`) consumed by the Meetropolis
server seed and the Phaser client.

The map builder exists so the office layout is reproducible. Editing the
office means editing the script and re-running it. There are no manual
edits to `office.json` and no binary asset commits that cannot be
regenerated from the inputs.

## Outputs

`build_office_map.py` writes:

- `apps/web/public/assets/tilesets/office_floor.png`
  - 9 columns x 9 rows of 16x16 tiles
  - Each row is a colorized variant of the upstream pixel-agents floor
    set, computed via a Photoshop-style colorize HSL transform
  - Row meanings: warm wood, blue-grey carpet, green carpet, dark walnut,
    light tile, caramel accent, cool grey, soft teal, warm beige
- `apps/web/public/assets/tilesets/office_wall.png`
  - 4 columns x 4 rows of 16x32 tiles
  - Copy of upstream `walls/wall_0.png`; bitmask convention:
    bit 0 = N (1), bit 1 = E (2), bit 2 = S (4), bit 3 = W (8)
- `apps/web/public/assets/tilesets/collision.png`
  - 16x16 translucent red marker, programmatically generated
- `apps/web/public/maps/office.json`
  - 50 x 40 grid at 16x16 tile size
  - Tilesets: the three sheets above plus one single-tile tileset per
    furniture PNG (about 30 entries), so the Tiled importer can resolve
    every object gid to its source PNG
  - Layers: Ground (tilelayer), Walls (tilelayer), Furniture
    (objectgroup), Decor (objectgroup), Collision (tilelayer)
  - Each object carries the seven custom properties the server-side
    importer consumes: `assetPackUuid`, `itemId`, `category`, `collide`,
    `tileX`, `tileY`, `footprintW`, `footprintH`

`render_preview.py` writes:

- `tools/map-builder/office_preview.png`
  - 4x-scaled composite preview, useful for offline visual inspection
  - Gitignored; regenerate locally when you need it

## Layout & floor design

The floor is deliberately calm. Every cell is the flat sub-tile (column 0)
of a color variant; zones are painted as solid-color "rugs" in a single
muted second color (`FLOOR_RUGS`), and the checker sub-tile appears only as
a small accent on the kitchenette coffee counter (`FLOOR_CHECKER`). There is
no per-cell scatter across the grout/brick sub-tiles.

The V2 "sand + blue-grey" scheme lays out, from the south entrance upward:
reception (the spawn point) at the entrance, an open-plan centre with two
bands of four desk pods, two enclosed meeting rooms plus an open collab bay
along the top, and a lounge and kitchenette in the bottom corners.

The spawn point is authored as `spawnX`/`spawnY` map properties (pixel
coords). The server importer (`apps/server/src/scripts/importMapV2.lib.ts`)
copies these into `Map.meta.spawn`, which the WorldRoom consumes.

## Why a per-furniture tileset, not one stitched sheet

The 25 pixel-agents furniture groups have irregular pixel sizes (a desk
is 48x32, a desk side is 16x64, a whiteboard is 32x32, etc.). Tiled does
not support multiple tile sizes inside a single tileset, so we keep each
furniture PNG as its own one-tile tileset and assign a sequential
firstgid range starting at 200. The bitmap files already live on disk
and Phaser handles loading dozens of small images fine.

## Dependencies

Python 3.10+ and Pillow:

```
python3 -m pip install --user Pillow
```

There is no `requirements.txt` or virtualenv on purpose; the tool is a
single-shot generator that runs locally during development. The Docker
build does not run this script — the resulting PNGs and `office.json`
are committed to the repo so the server seed and Phaser client can read
them directly without a Python runtime in the container.

## Usage

From the repository root:

```
python3 tools/map-builder/build_office_map.py
python3 tools/map-builder/render_preview.py
```

The first command regenerates the tilesheets and `office.json`. The
second composites a `office_preview.png` for inspection.

After editing the script:

1. Run `build_office_map.py`.
2. Optional: run `render_preview.py` and eyeball the PNG.
3. Commit the regenerated `office.json` and any changed PNGs.
4. The next `prisma db seed` (or `docker compose up -d --build`) picks
   the new map up via the importer wired into `apps/server/prisma/seed.ts`.

## Licensing

Build scripts: AGPL-3.0-only (match the rest of the meetropolis server
tooling). The pixel-agents source PNGs they read are MIT — see
`THIRD_PARTY_LICENSES/MIT-pixel-agents.txt`.
