# SPDX-License-Identifier: AGPL-3.0-only
"""Meetropolis Sprite Generator V4 — CLI + character resolution.

Turns a small declarative :class:`Character` (skin + hair + outfit +
accessories) into a 128x256 spritesheet by pulling grids from the
``catalogs`` package and running them through ``poses`` + ``engine``.

Usage::

    python3 generate.py                 # write the 6 defaults into the repo
    python3 generate.py --out DIR       # write the 6 defaults elsewhere
    python3 generate.py --list          # print the default character configs

Every run first validates the catalog: all beard and glasses front grids
must be mirror-symmetric around x=15.5 (shape AND colour), or generation
aborts. See ``validate.py`` for the sheet-level acceptance checks.
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass, field

from PIL import Image

import engine
import poses
from catalogs import accessories, beards, bodies, bottoms_shoes, hairstyles, tops

HERE = os.path.dirname(os.path.abspath(__file__))
SPRITES_DIR = os.path.normpath(
    os.path.join(HERE, '..', '..', 'apps', 'web', 'public', 'assets', 'sprites')
)


@dataclass(frozen=True)
class Character:
    """Declarative character recipe. Keys reference catalog entries."""
    skin: str                     # bodies.SKINS
    hair: str                     # hairstyles.HAIRSTYLES
    hair_color: str               # hairstyles.HAIR_COLORS
    outfit: str = 'trousers'      # 'trousers' | 'dress' | 'base'
    top: str = None               # tops.TOP_PALETTES (trousers/dress)
    pants: str = None             # bottoms_shoes.PANTS_PALETTES (trousers)
    shoes: str = None             # bottoms_shoes.SHOE_PALETTES (trousers/dress)
    beard: str = None             # beards.BEARDS
    beard_color: str = 'braun'    # beards.BEARD_COLORS
    glasses: str = None           # accessories.GLASSES_TYPES
    hat: str = None               # accessories.HATS key or 'hood'
    misc: str = None              # accessories.MISC (chain / pacifier / cigarette)


# --- catalog validation ---------------------------------------------------
def validate_catalog() -> list:
    """Return every front-symmetry violation across beards and glasses."""
    issues = []
    for name, grid in beards.BEARDS.items():
        issues += engine.check_front_symmetry(f'beard:{name}', grid['front'])
    for name, (grid, _pal) in accessories.GLASSES_TYPES.items():
        issues += engine.check_front_symmetry(f'glasses:{name}', grid['front'])
    return issues


# --- kit + palette resolution ---------------------------------------------
def _outfit_kit(char: Character) -> dict:
    """Slots that depend on the outfit mode (trousers / dress / base)."""
    if char.outfit == 'trousers':
        return {
            'bottom': bottoms_shoes.BOTTOM_FRONT,
            'shoe_l': bottoms_shoes.SHOE_FRONT_L, 'shoe_r': bottoms_shoes.SHOE_FRONT_R,
            'top_front': tops.TOP_FRONT, 'top_side': tops.TOP_SIDE, 'top_rear': tops.TOP_REAR,
            'leg_back': bottoms_shoes.LEG_SIDE_BACK, 'shoe_back': bottoms_shoes.SHOE_SIDE_BACK,
            'bottom_side': bottoms_shoes.BOTTOM_SIDE,
            'leg_front': bottoms_shoes.LEG_SIDE_FRONT, 'shoe_front': bottoms_shoes.SHOE_SIDE_FRONT,
            'arm_side': tops.ARM_SIDE, 'underwear_front': None, 'hand_swing': True,
        }
    if char.outfit == 'dress':
        return {
            'bottom': bodies.LEGS_BARE_FRONT,
            'shoe_l': bottoms_shoes.SHOE_FRONT_L, 'shoe_r': bottoms_shoes.SHOE_FRONT_R,
            'top_front': tops.DRESS_FRONT, 'top_side': tops.DRESS_SIDE, 'top_rear': tops.DRESS_REAR,
            'leg_back': bodies.LEG_BARE_SIDE_BACK, 'shoe_back': bottoms_shoes.SHOE_SIDE_BACK,
            'bottom_side': None,
            'leg_front': bodies.LEG_BARE_SIDE_FRONT, 'shoe_front': bottoms_shoes.SHOE_SIDE_FRONT,
            'arm_side': tops.ARM_SIDE_SHORT, 'underwear_front': None, 'hand_swing': False,
        }
    if char.outfit == 'base':
        return {
            'bottom': bodies.LEGS_BARE_FULL_FRONT,
            'shoe_l': bodies.FEET_BARE_L, 'shoe_r': bodies.FEET_BARE_R,
            'top_front': bodies.TORSO_BARE_FRONT, 'top_side': bodies.TORSO_BARE_SIDE,
            'top_rear': bodies.TORSO_BARE_REAR,
            'leg_back': bodies.LEG_BARE_FULL_SIDE_BACK, 'shoe_back': bodies.FOOT_BARE_SIDE_BACK,
            'bottom_side': bodies.UNDERWEAR_SIDE,
            'leg_front': bodies.LEG_BARE_FULL_SIDE_FRONT, 'shoe_front': bodies.FOOT_BARE_SIDE_FRONT,
            'arm_side': bodies.ARM_BARE_SIDE, 'underwear_front': bodies.UNDERWEAR_FRONT,
            'hand_swing': True,
        }
    raise ValueError(f'unknown outfit: {char.outfit!r}')


def resolve(char: Character) -> tuple:
    """Return ``(kit, palette_dict)`` for a character, validating the combo."""
    skin = bodies.SKINS[char.skin]
    hair_pal = hairstyles.HAIR_COLORS[char.hair_color]
    style = hairstyles.HAIRSTYLES[char.hair]

    palettes = [bodies.PAL_COMMON, skin, bodies.FACE_COMMON,
                hair_pal, {'R': hair_pal['j']}]

    kit = _outfit_kit(char)
    kit.update({
        'body_front': bodies.BODY_FRONT, 'body_side': bodies.BODY_SIDE,
        'body_rear': bodies.BODY_REAR,
        'face_front': bodies.FACE_FRONT, 'face_side': bodies.FACE_SIDE,
        'hand_l': tops.HAND_FRONT_L, 'hand_r': tops.HAND_FRONT_R,
        'hair_front': style['front'], 'hair_side': style['side'], 'hair_rear': style['rear'],
    })

    if char.outfit == 'trousers':
        palettes.append(tops.TOP_PALETTES[char.top])
        palettes.append(bottoms_shoes.PANTS_PALETTES[char.pants])
        palettes.append(bottoms_shoes.SHOE_PALETTES[char.shoes])
    elif char.outfit == 'dress':
        palettes.append(tops.TOP_PALETTES[char.top])
        palettes.append(bottoms_shoes.SHOE_PALETTES[char.shoes])
    elif char.outfit == 'base':
        palettes.append(bodies.PAL_UNDERWEAR)

    if char.beard:
        kit['beard_front'] = beards.BEARDS[char.beard]['front']
        kit['beard_side'] = beards.BEARDS[char.beard]['side']
        palettes.append(beards.BEARD_COLORS[char.beard_color])
    if char.glasses:
        grid, pal = accessories.GLASSES_TYPES[char.glasses]
        kit['glasses_front'] = grid['front']
        kit['glasses_side'] = grid['side']
        palettes.append(pal)
    if char.hat == 'hood':
        # The hood replaces the hairstyle and excludes hats; it recolours
        # from the worn top's t/u/v slots, so a top palette is required.
        if not any('t' in p for p in palettes):
            raise ValueError('hood needs a top palette (not valid with base outfit)')
        kit['hair_front'] = accessories.HOOD['front']
        kit['hair_side'] = accessories.HOOD['side']
        kit['hair_rear'] = accessories.HOOD['rear']
    elif char.hat:
        grid, pal = accessories.HATS[char.hat]
        kit['hat_front'] = grid['front']
        kit['hat_side'] = grid['side']
        kit['hat_rear'] = grid['rear']
        palettes.append(pal)
    if char.misc:
        grid, pal = accessories.MISC[char.misc]
        kit['misc_front'] = grid['front']
        kit['misc_side'] = grid['side']
        kit['misc_rear'] = grid['rear']
        palettes.append(pal)

    return kit, engine.parse_palette(palettes)


# --- rendering ------------------------------------------------------------
def render_states(char: Character) -> dict:
    """Render all 8 states to RGBA frames (right = mirrored left)."""
    kit, pal = resolve(char)
    authored = poses.build_states(kit)
    out = {}
    for state, parts_list in authored.items():
        out[state] = [engine.render_frame(p, pal) for p in parts_list]
    out['idle_right'] = [engine.flip_image(im) for im in out['idle_left']]
    out['walk_right'] = [engine.flip_image(im) for im in out['walk_left']]
    return out


def build_sheet(char: Character) -> Image.Image:
    return engine.compose_sheet(render_states(char))


# --- the six built-in defaults --------------------------------------------
DEFAULTS = {
    'business_man':   Character('medium', 'buzz', 'braun', 'trousers',
                                top='shirt_white', pants='navy', shoes='brown'),
    'business_woman': Character('light', 'bob', 'schwarz', 'trousers',
                                top='shirt_white', pants='navy', shoes='brown'),
    'casual_woman':   Character('medium', 'ponytail', 'rot', 'dress',
                                top='dress_red', shoes='brown'),
    'dev_hoodie':     Character('light', 'messy', 'braun', 'trousers',
                                top='hoodie_blue', pants='dark', shoes='black'),
    'manager_woman':  Character('dark', 'long', 'blond', 'trousers',
                                top='blazer_anthracite', pants='dark', shoes='black'),
    'suit_man':       Character('tan', 'side_part', 'schwarz', 'trousers',
                                top='suit_navy', pants='dark', shoes='black'),
}


def write_defaults(out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    for name, char in DEFAULTS.items():
        sheet = build_sheet(char)
        sheet.save(os.path.join(out_dir, f'{name}.png'), 'PNG')
        print(f'wrote {name}.png  ({sheet.size[0]}x{sheet.size[1]})')


# --- golden fixture corpus ------------------------------------------------
# The six DEFAULTS only ever exercise trousers/dress; base, hood, every hat,
# beard, glasses, misc and `bald` are NEVER rendered by them. A TS composer
# verified only against the defaults would silently pass for those untested
# paths. This corpus renders every outfit mode x every accessory slot x hood x
# bald x every catalog entry at least once, so the pixel-golden test against it
# actually proves the TS interpreter reproduces the Python reference in full.
FIXTURES = {
    # every hairstyle once, spread across all skins / hair colours / tops /
    # pants / shoes so those value sets are covered too (trousers).
    'fx_hair_messy':     Character('light', 'messy', 'braun', 'trousers', top='shirt_white', pants='dark', shoes='black'),
    'fx_hair_bob':       Character('medium', 'bob', 'blond', 'trousers', top='hoodie_blue', pants='navy', shoes='brown'),
    'fx_hair_buzz':      Character('tan', 'buzz', 'schwarz', 'trousers', top='suit_navy', pants='dark', shoes='black'),
    'fx_hair_side_part': Character('dark', 'side_part', 'rot', 'trousers', top='blazer_anthracite', pants='navy', shoes='brown'),
    'fx_hair_curly':     Character('light', 'curly', 'grau', 'trousers', top='shirt_white', pants='dark', shoes='black'),
    'fx_hair_spiky':     Character('medium', 'spiky', 'braun', 'trousers', top='hoodie_blue', pants='navy', shoes='brown'),
    'fx_hair_long':      Character('tan', 'long', 'blond', 'trousers', top='suit_navy', pants='dark', shoes='black'),
    'fx_hair_ponytail':  Character('dark', 'ponytail', 'schwarz', 'trousers', top='blazer_anthracite', pants='navy', shoes='brown'),
    'fx_hair_bun':       Character('light', 'bun', 'rot', 'trousers', top='shirt_white', pants='dark', shoes='black'),
    'fx_hair_braids':    Character('medium', 'braids', 'grau', 'trousers', top='dress_red', pants='navy', shoes='brown'),
    'fx_hair_bald':      Character('tan', 'bald', 'braun', 'trousers', top='suit_navy', pants='dark', shoes='black'),
    # beards x beard colours (+ glasses coverage).
    'fx_beard_schnauzer':  Character('light', 'buzz', 'braun', 'trousers', top='shirt_white', pants='dark', shoes='black', beard='schnauzer', beard_color='braun'),
    'fx_beard_vollbart':   Character('medium', 'messy', 'schwarz', 'trousers', top='hoodie_blue', pants='navy', shoes='brown', beard='vollbart', beard_color='schwarz', glasses='rect'),
    'fx_beard_ziegenbart': Character('tan', 'side_part', 'blond', 'trousers', top='suit_navy', pants='dark', shoes='black', beard='ziegenbart', beard_color='blond', glasses='round'),
    'fx_beard_grey_prof':  Character('dark', 'buzz', 'grau', 'trousers', top='blazer_anthracite', pants='navy', shoes='brown', beard='schnauzer', beard_color='grau', glasses='prof'),
    # every hat (trousers).
    'fx_hat_cap':      Character('light', 'messy', 'braun', 'trousers', top='shirt_white', pants='dark', shoes='black', hat='cap'),
    'fx_hat_cowboy':   Character('medium', 'bob', 'blond', 'trousers', top='hoodie_blue', pants='navy', shoes='brown', hat='cowboy'),
    'fx_hat_zylinder': Character('tan', 'buzz', 'schwarz', 'trousers', top='suit_navy', pants='dark', shoes='black', hat='zylinder'),
    'fx_hat_krone':    Character('dark', 'long', 'rot', 'trousers', top='blazer_anthracite', pants='navy', shoes='brown', hat='krone'),
    'fx_hat_diadem':   Character('light', 'ponytail', 'grau', 'trousers', top='shirt_white', pants='dark', shoes='black', hat='diadem'),
    'fx_hat_bierhelm': Character('medium', 'spiky', 'braun', 'trousers', top='hoodie_blue', pants='navy', shoes='brown', hat='bierhelm'),
    # hood (replaces hair, needs a top palette) — trousers and dress.
    'fx_hood_trousers': Character('tan', 'long', 'schwarz', 'trousers', top='hoodie_blue', pants='dark', shoes='black', hat='hood'),
    'fx_hood_dress':    Character('dark', 'bob', 'blond', 'dress', top='dress_red', shoes='brown', hat='hood'),
    # misc (trousers).
    'fx_misc_kette':     Character('light', 'bob', 'braun', 'trousers', top='shirt_white', pants='dark', shoes='black', misc='kette'),
    'fx_misc_schnuller': Character('medium', 'messy', 'blond', 'trousers', top='hoodie_blue', pants='navy', shoes='brown', misc='schnuller'),
    'fx_misc_zigarette': Character('tan', 'buzz', 'schwarz', 'trousers', top='suit_navy', pants='dark', shoes='black', misc='zigarette'),
    # dress silhouette across tops / shoes / accessories.
    'fx_dress_red':      Character('light', 'long', 'rot', 'dress', top='dress_red', shoes='brown'),
    'fx_dress_navy':     Character('medium', 'bun', 'schwarz', 'dress', top='suit_navy', shoes='black', beard=None, glasses='rect'),
    'fx_dress_hat':      Character('tan', 'braids', 'braun', 'dress', top='shirt_white', shoes='brown', hat='cap', misc='kette'),
    # base outfit (nude + accessories); hood is invalid with base.
    'fx_base_bald':      Character('light', 'bald', 'schwarz', 'base'),
    'fx_base_hair':      Character('dark', 'long', 'blond', 'base'),
    'fx_base_accessory': Character('medium', 'buzz', 'braun', 'base', beard='vollbart', beard_color='braun', glasses='prof'),
    'fx_base_hat_misc':  Character('tan', 'spiky', 'grau', 'base', hat='cowboy', misc='zigarette'),
    # kitchen sink: hat + beard + glasses + misc + long hair on trousers.
    'fx_combo_all':      Character('dark', 'long', 'schwarz', 'trousers', top='suit_navy', pants='dark', shoes='black', beard='vollbart', beard_color='grau', glasses='rect', hat='cap', misc='kette'),
    # hood + beard + glasses + misc (hood occupies the hat slot).
    'fx_hood_combo':     Character('medium', 'messy', 'braun', 'trousers', top='blazer_anthracite', pants='navy', shoes='brown', beard='ziegenbart', beard_color='schwarz', glasses='round', hat='hood', misc='schnuller'),
}


def write_fixtures(out_dir: str) -> None:
    """Render the golden fixture corpus + a fixtures.json config manifest.

    The manifest lets the TypeScript golden test drive the shared composer with
    the exact same configs, then compare pixels against these reference PNGs.
    """
    import json
    os.makedirs(out_dir, exist_ok=True)
    manifest = []
    for name, char in FIXTURES.items():
        sheet = build_sheet(char)
        sheet.save(os.path.join(out_dir, f'{name}.png'), 'PNG')
        manifest.append({'name': name, 'config': vars(char)})
    with open(os.path.join(out_dir, 'fixtures.json'), 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print(f'wrote {len(manifest)} fixtures + fixtures.json to {out_dir}')


def main() -> int:
    parser = argparse.ArgumentParser(description='Meetropolis sprite generator V4')
    parser.add_argument('--out', default=SPRITES_DIR,
                        help='output directory (default: repo sprites dir)')
    parser.add_argument('--list', action='store_true',
                        help='print the default character configs and exit')
    parser.add_argument('--fixtures', metavar='DIR',
                        help='render the golden fixture corpus + fixtures.json '
                             'into DIR (for the shared-composer pixel test)')
    args = parser.parse_args()

    if args.list:
        for name, char in DEFAULTS.items():
            print(f'{name}: {char}')
        return 0

    issues = validate_catalog()
    if issues:
        print('catalog symmetry check FAILED:', file=sys.stderr)
        for line in issues:
            print(f'  {line}', file=sys.stderr)
        return 1

    if args.fixtures:
        write_fixtures(args.fixtures)
        return 0

    write_defaults(args.out)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
