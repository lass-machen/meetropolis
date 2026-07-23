# Meetropolis Sprite Generator

Procedural pixel-character generator for Meetropolis' default avatars.
Produces deterministic 32x32 chibi office characters as spritesheets ready
for Phaser (`apps/web/public/assets/sprites/*.png`).

Version 4 is built as a **small engine + data catalogs**: everything
visual (bodies, hairstyles, garments, accessories, beards) lives as plain
character-grid data, and a character is just a short recipe that selects
catalog entries. The same data is exported to JSON as the contract for a
future in-app character editor.

## Output format

- Frame: 32x32, transparent background. Figure ~28px tall.
- Sheet: 128x256 (4 columns x 8 rows).
- Rows 0-3: idle down / left / right / up (column 0 only; columns 1-3
  transparent).
- Rows 4-7: walk cycle down / left / right / up (all 4 columns, frame
  order contact-pass-contact-pass at 8 fps).
- Outline color: `#2e222f` (dark plum). Small hand-picked palettes; every
  sheet stays well under the 32-color budget.

## Architecture

```
engine.py            layer() authoring, palette parsing, render_frame,
                     compose_sheet (128x256), front-symmetry check.
poses.py             idle + 4-frame walk choreography (trousers / dress /
                     base) driven by a resolved "kit" of grids.
catalogs/            pure DATA — grids + palettes, no logic:
  bodies.py            skin, face, head/neck, bare torso/legs/feet,
                       underwear.
  hairstyles.py        10 styles (front/side/rear) + hair colours.
  tops.py              trousers-top + dress shapes, hands, arms, palettes.
  bottoms_shoes.py     pants/leg/shoe grids + palettes.
  accessories.py       hats, hood, glasses, misc + palettes.
  beards.py            3 beards + colours.
generate.py          Character recipe -> kit -> sheet; the 6 defaults; CLI.
export_catalog.py    dump the catalogs to catalog.json (editor contract).
validate.py          sheet-level acceptance checks.
```

Side views are authored facing LEFT; the right-facing states are the
mirrored left renders. Walk rule that must not be "improved" without a
review: pass frames tuck the body group **+1px down** (lifting it tears a
gap between torso and pants); dress puff sleeves disable the vertical
hand-swing.

## Usage

```bash
cd tools/sprite-generator
python3 -m venv .venv && source .venv/bin/activate && pip install Pillow
# (Pillow is the only dependency; Python 3.13 + Pillow 11 tested)

python3 generate.py            # write the 6 defaults into the repo sprites dir
python3 generate.py --out DIR  # write them elsewhere (e.g. for inspection)
python3 generate.py --list     # print the default character recipes

python3 export_catalog.py      # write the canonical editor contract to
                               # packages/shared/sprite/catalog.json

python3 validate.py apps/web/public/assets/sprites/business_man.png
python3 validate.py DIR/*.png  # validate several sheets at once
```

`generate.py` validates the catalog before writing: every beard and
glasses **front** grid must be mirror-symmetric around x=15.5 (shape AND
colour), or generation aborts with the offending pixels listed.
Hairstyles are exempt (some are intentionally asymmetric, e.g.
`side_part`).

## Checks (validate.py)

Ten mechanical checks per sheet, all must pass:

1. PNG mode is RGBA.
2. Sheet is 128x256.
3-5. Idle column-0 cells filled; idle columns 1-3 transparent; all walk
   cells filled.
6. Palette size ≤ 32 colours.
7. Sheet dimensions are frame-aligned.
8. Each walk row has ≥ 2 distinct frames (animation is visible).
9. All four idle directions differ.
10. **No enclosed transparent holes**: a border flood-fill (4-connected)
    marks every transparent pixel reachable from the frame edge; any
    transparent pixel it cannot reach is enclosed — background showing
    through the figure — and fails. Natural openings that connect to the
    edge (the gap between the legs, L-/step notches) stay reachable and
    are correctly not flagged.

## Adding characters / combinations

A `Character` (see `generate.py`) is a recipe of catalog keys:

```python
Character(skin='tan', hair='side_part', hair_color='schwarz',
          outfit='trousers', top='suit_navy', pants='dark', shoes='black',
          beard='vollbart', beard_color='grau', glasses='rect')
```

`outfit` is `trousers`, `dress` (worn over bare legs) or `base` (naked +
underwear, the editor's starting point). Add an entry to `DEFAULTS` or
call `generate.build_sheet(character)` from your own script. Combination
rules (hood replaces hair and excludes hats, beards not visible from the
rear, etc.) are documented in `catalog.json` under `rules`.

## catalog.json (schema `meetropolis-sprite-catalog/v5`)

`export_catalog.py` serializes the frame format, the slot legend, every
grid as an array of 32 strings, all palettes, the walk choreography
constants, the combination rules and the six default recipes. The canonical
output lives at `packages/shared/sprite/catalog.json` (see its `NOTICE` for
the MIT licensing of this generated output) and is read by both the server
and the web editor,
so a composited sheet and the editor's live preview are pixel-identical.

Schema v5 adds a machine-readable `compose` block that turns the character
resolution in `generate.py` and the choreography in `poses.py` into pure
DATA (`base_kit`, `hair_slots`, `outfits`, `accessories`, `palette_compose`,
`part_layout`, `fields`, `sequences`, `states`, `sheet_placement`,
`config_fields`, `hard_rules`). A single isomorphic TypeScript interpreter
reproduces any sheet from this block alone — no rendering, outfit or pose
logic is re-encoded in TS, so the two implementations cannot drift. Verified
by a pixel-golden test over the fixture corpus (`generate.py --fixtures`).

## Licensing

The generator code in this directory is AGPL-3.0-only (SPDX headers in
`engine.py`, `generate.py`, `poses.py`, `export_catalog.py`). Its generated
output — `catalog.json` and the six built-in character sprites in
`apps/web/public/assets/sprites/` — is licensed under MIT, consistent with the
`@meetropolis/shared` and `apps/web` packages it ships in. Tiamat UG holds the
copyright in both the generator and its output and licenses that output under
MIT; the AGPL-3.0 copyleft applies to third parties who run the generator
themselves. All pixel data is authored procedurally from the grid templates in
`catalogs/` — no third-party pixel data is read, sampled, or referenced.
