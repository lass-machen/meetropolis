# SPDX-License-Identifier: AGPL-3.0-only
"""Export the sprite catalogs to a single JSON contract.

The JSON is the foundation for a future TypeScript port of the in-app
character editor: it carries the frame format, the slot legend, every
grid as an array of 32 strings, all palettes, the walk choreography
constants, the combination rules, and the six default recipes. Nothing
here is rendering logic — a TS reader can reproduce a sheet from this
file plus a re-implementation of ``engine.render_frame`` + ``poses``.

Usage::

    python3 export_catalog.py            # -> tools/sprite-generator/catalog.json
    python3 export_catalog.py --out X.json
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import sys

import engine
import generate
import poses
from catalogs import accessories, beards, bodies, bottoms_shoes, hairstyles, tops


# ---------------------------------------------------------------------------
# Editions extensibility (additive, loader-boundary parity with adminLoader)
# ---------------------------------------------------------------------------
# An optional closed-source module may contribute extra catalog entries. It is
# loaded by name (default `sprite_catalog_ee`, overridable via env), and its
# entries are merged additively under an `ee:` key prefix so they cannot collide
# with future OSS keys. OSS never imports EE directly; EE only injects DATA into
# the single catalog.json contract, and the OSS composer renders it unchanged.
# When the module is absent (OSS-only build), every merge is a no-op.

def _load_ee_catalog():
    name = os.environ.get('SPRITE_CATALOG_EE_MODULE', 'sprite_catalog_ee')
    try:
        return importlib.import_module(name)
    except ImportError:
        return None


_EE = _load_ee_catalog()


def _ee_prefixed(attr: str) -> dict:
    """EE entries for a catalog attribute, namespaced with an `ee:` prefix."""
    if _EE is None:
        return {}
    src = getattr(_EE, attr, {}) or {}
    return {f'ee:{k}': v for k, v in src.items()}


def _merged(base: dict, attr: str) -> dict:
    """Base OSS dict additively merged with the prefixed EE entries (if any)."""
    return {**base, **_ee_prefixed(attr)}

HERE = os.path.dirname(os.path.abspath(__file__))
# Canonical runtime catalog: a single committed file consumed by BOTH the
# server (fs read) and the web editor (bundled asset), so preview == sheet.
CATALOG_OUT = os.path.normpath(
    os.path.join(HERE, '..', '..', 'packages', 'shared', 'sprite', 'catalog.json')
)

SLOT_LEGEND = {
    'O': 'outline', 'a': 'skin_hl', 'b': 'skin_mid', 'c': 'skin_sh',
    'E': 'eye', 'W': 'eye_shine', 'M': 'mouth', 'R': 'brow',
    'h': 'hair_hl', 'i': 'hair_mid', 'j': 'hair_sh',
    't': 'top_hl', 'u': 'top_mid', 'v': 'top_sh',
    'p': 'pants_mid', 'q': 'pants_sh',
    's': 'shoe_mid', 'r': 'shoe_hl', 'd': 'shoe_sh',
    'w': 'underwear_mid', 'x': 'underwear_sh',
    'e': 'beard_hl', 'f': 'beard_mid', 'g': 'beard_sh',
    '.': 'transparent',
}

RULES = [
    'The hood replaces the hairstyle and excludes all hats.',
    'The hood recolours from the worn top via the t/u/v slots.',
    'A hat draws over the hair top zone (y3-8); long hairstyles still show below it.',
    'Glasses draw between face and hair; the hair fringe covers their top edge.',
    'Beards draw below the hairline and are not visible from the rear.',
    'Beard and glasses front grids must be mirror-symmetric around x=15.5 (shape AND colour).',
    'Hairstyle front grids may be asymmetric (e.g. side_part) and are NOT symmetry-checked.',
    'A dress is worn over bare legs and disables the vertical hand-swing during the walk.',
    'The cigarette is intentionally asymmetric (hangs from the left mouth corner).',
    'Brow colour (slot R) is derived from the hair shadow slot (j).',
]

# ---------------------------------------------------------------------------
# v5 machine-readable compose contract
# ---------------------------------------------------------------------------
# Everything below turns the character-resolution + choreography logic that
# lives as CODE in ``generate.py`` and ``poses.py`` into DATA, so a single
# isomorphic TypeScript interpreter can reproduce a sheet without re-encoding
# any of that logic (which would drift). Grid references are dot-paths into
# ``catalogs`` (e.g. ``bodies.body.front`` -> catalogs.bodies.body.front); a
# ``{field}`` segment is substituted from the character config at resolve time
# (e.g. ``hairstyles.{hair}.front``). Every value here is derived from the same
# source constants the Python generator uses, never hand-transcribed.

HOOD_HAT_VALUE = 'hood'

# Outfit-independent, always-present kit slots (mirrors generate.resolve()).
BASE_KIT = {
    'body_front': 'bodies.body.front',
    'body_side': 'bodies.body.side',
    'body_rear': 'bodies.body.rear',
    'face_front': 'bodies.face.front',
    'face_side': 'bodies.face.side',
    'hand_l': 'tops.hands.front_l',
    'hand_r': 'tops.hands.front_r',
}

# Hair grids depend on the chosen style; the hood may later replace them.
HAIR_SLOTS = {
    'hair_front': 'hairstyles.{hair}.front',
    'hair_side': 'hairstyles.{hair}.side',
    'hair_rear': 'hairstyles.{hair}.rear',
}

# Kit slots that depend on the outfit mode (mirrors generate._outfit_kit()).
# Only non-empty slots are listed; an absent slot is treated as None.
OUTFITS = {
    'trousers': {
        'hand_swing': True,
        'slots': {
            'bottom': 'bottoms.trousers.front',
            'shoe_l': 'bottoms.shoes.front_l',
            'shoe_r': 'bottoms.shoes.front_r',
            'top_front': 'tops.trousers.front',
            'top_side': 'tops.trousers.side',
            'top_rear': 'tops.trousers.rear',
            'leg_back': 'bottoms.legs_side.back',
            'shoe_back': 'bottoms.shoes.side_back',
            'bottom_side': 'bottoms.trousers.side',
            'leg_front': 'bottoms.legs_side.front',
            'shoe_front': 'bottoms.shoes.side_front',
            'arm_side': 'tops.arms.side',
        },
    },
    'dress': {
        'hand_swing': False,
        'slots': {
            'bottom': 'bodies.legs_bare_dress.front',
            'shoe_l': 'bottoms.shoes.front_l',
            'shoe_r': 'bottoms.shoes.front_r',
            'top_front': 'tops.dress.front',
            'top_side': 'tops.dress.side',
            'top_rear': 'tops.dress.rear',
            'leg_back': 'bodies.legs_bare_dress.side_back',
            'shoe_back': 'bottoms.shoes.side_back',
            'leg_front': 'bodies.legs_bare_dress.side_front',
            'shoe_front': 'bottoms.shoes.side_front',
            'arm_side': 'tops.arms.side_short',
        },
    },
    'base': {
        'hand_swing': True,
        'slots': {
            'bottom': 'bodies.legs_bare_full.front',
            'shoe_l': 'bodies.feet_bare.front_l',
            'shoe_r': 'bodies.feet_bare.front_r',
            'top_front': 'bodies.torso_bare.front',
            'top_side': 'bodies.torso_bare.side',
            'top_rear': 'bodies.torso_bare.rear',
            'leg_back': 'bodies.legs_bare_full.side_back',
            'shoe_back': 'bodies.feet_bare.side_back',
            'bottom_side': 'bodies.underwear.side',
            'leg_front': 'bodies.legs_bare_full.side_front',
            'shoe_front': 'bodies.feet_bare.side_front',
            'arm_side': 'bodies.arm_bare_side',
            'underwear_front': 'bodies.underwear.front',
        },
    },
}

# Conditional accessory slots (mirrors the tail of generate.resolve()).
ACCESSORIES = {
    'beard': {
        'field': 'beard',
        'slots': {
            'beard_front': 'beards.{beard}.front',
            'beard_side': 'beards.{beard}.side',
        },
    },
    'glasses': {
        'field': 'glasses',
        'slots': {
            'glasses_front': 'glasses.{glasses}.front',
            'glasses_side': 'glasses.{glasses}.side',
        },
    },
    # The hat field is special: value 'hood' replaces the hair slots and adds
    # no hat slots; any other value fills the hat slots and adds no hair swap.
    'hat': {
        'field': 'hat',
        'hood_value': HOOD_HAT_VALUE,
        'hood_slots': {
            'hair_front': 'hood.front',
            'hair_side': 'hood.side',
            'hair_rear': 'hood.rear',
        },
        'slots': {
            'hat_front': 'hats.{hat}.front',
            'hat_side': 'hats.{hat}.side',
            'hat_rear': 'hats.{hat}.rear',
        },
    },
    'misc': {
        'field': 'misc',
        'slots': {
            'misc_front': 'misc.{misc}.front',
            'misc_side': 'misc.{misc}.side',
            'misc_rear': 'misc.{misc}.rear',
        },
    },
}

# Ordered palette assembly (later wins), mirroring generate.resolve(). Each
# entry references either a flat palette (``palettes.<ref>``), a keyed palette
# (``palettes.<ref>[config.<key>]``), an accessory palette embedded in a
# catalog group (``catalogs.<catalog>[config.<key>].palette``), or a derived
# single-slot colour.
PALETTE_COMPOSE = {
    'base': [
        {'ref': 'outline'},
        {'ref': 'skin', 'key': 'skin'},
        {'ref': 'face'},
        {'ref': 'hair', 'key': 'hair_color'},
        {'derive': {'slot': 'R', 'ref': 'hair', 'key': 'hair_color', 'from_slot': 'j'}},
    ],
    'per_mode': {
        'trousers': [
            {'ref': 'top', 'key': 'top'},
            {'ref': 'pants', 'key': 'pants'},
            {'ref': 'shoes', 'key': 'shoes'},
        ],
        'dress': [
            {'ref': 'top', 'key': 'top'},
            {'ref': 'shoes', 'key': 'shoes'},
        ],
        'base': [
            {'ref': 'underwear'},
        ],
    },
    'accessories': [
        {'when': 'beard', 'ref': 'beard', 'key': 'beard_color'},
        {'when': 'glasses', 'catalog': 'glasses', 'key': 'glasses'},
        {'when': 'hat', 'catalog': 'hats', 'key': 'hat', 'skip_value': HOOD_HAT_VALUE},
        {'when': 'misc', 'catalog': 'misc', 'key': 'misc'},
    ],
}


def _part(slot, dx, dy):
    return {'slot': slot, 'dx': dx, 'dy': dy}


# Per-view part layout: ordered {slot, dx-expr, dy-expr}. An expr is a list of
# terms summed together; a term is either a choreography field name or
# ``{field, mul: 'hand_swing'}``. Mirrors poses.front_parts / rear_parts /
# side_parts exactly (including render order).
_HANDS = [
    _part('hand_l', [], ['bob', {'field': 'left_hand_dy', 'mul': 'hand_swing'}]),
    _part('hand_r', [], ['bob', {'field': 'right_hand_dy', 'mul': 'hand_swing'}]),
]
PART_LAYOUT = {
    'front': [
        _part('bottom', [], []),
        _part('shoe_l', [], ['left_shoe_dy']),
        _part('shoe_r', [], ['right_shoe_dy']),
        _part('underwear_front', [], []),
        _part('body_front', [], ['bob']),
        _part('top_front', [], ['bob']),
        *_HANDS,
        _part('face_front', [], ['bob']),
        _part('beard_front', [], ['bob']),
        _part('glasses_front', [], ['bob']),
        _part('hair_front', [], ['bob']),
        _part('hat_front', [], ['bob']),
        _part('misc_front', [], ['bob']),
    ],
    'rear': [
        _part('bottom', [], []),
        _part('shoe_l', [], ['left_shoe_dy']),
        _part('shoe_r', [], ['right_shoe_dy']),
        _part('underwear_front', [], []),
        _part('body_rear', [], ['bob']),
        _part('top_rear', [], ['bob']),
        *_HANDS,
        _part('hair_rear', [], ['bob']),
        _part('hat_rear', [], ['bob']),
        _part('misc_rear', [], ['bob']),
    ],
    'side': [
        _part('leg_back', ['back_leg_dx'], ['back_leg_dy']),
        _part('shoe_back', ['back_leg_dx'], ['back_leg_dy']),
        _part('bottom_side', [], []),
        _part('leg_front', ['front_leg_dx'], ['front_leg_dy']),
        _part('shoe_front', ['front_leg_dx'], ['front_leg_dy']),
        _part('body_side', [], ['bob']),
        _part('top_side', [], ['bob']),
        _part('face_side', [], ['bob']),
        _part('beard_side', [], ['bob']),
        _part('glasses_side', [], ['bob']),
        _part('hair_side', [], ['bob']),
        _part('arm_side', ['arm_dx'], ['bob']),
        _part('hat_side', [], ['bob']),
        _part('misc_side', [], ['bob']),
    ],
}

# Field names for each view's choreography vector (front/rear share the vector,
# matching poses.WALK_FRONT / WALK_SIDE tuple order).
FIELDS = {
    'front': ['bob', 'left_shoe_dy', 'right_shoe_dy', 'left_hand_dy', 'right_hand_dy'],
    'side': ['bob', 'front_leg_dx', 'front_leg_dy', 'back_leg_dx', 'back_leg_dy', 'arm_dx'],
}
FIELDS['rear'] = FIELDS['front']

# One frame-vector list per animation sequence. Idle is a single zero frame.
SEQUENCES = {
    'idle_front': [list(poses.IDLE_FRONT)],
    'idle_side': [list(poses.IDLE_SIDE)],
    'walk_front': [list(f) for f in poses.WALK_FRONT],
    'walk_side': [list(f) for f in poses.WALK_SIDE],
}

# The eight sheet states: authored view + sequence, or a mirror of another.
STATES = {
    'idle_down': {'view': 'front', 'sequence': 'idle_front'},
    'idle_left': {'view': 'side', 'sequence': 'idle_side'},
    'idle_right': {'mirror': 'idle_left'},
    'idle_up': {'view': 'rear', 'sequence': 'idle_front'},
    'walk_down': {'view': 'front', 'sequence': 'walk_front'},
    'walk_left': {'view': 'side', 'sequence': 'walk_side'},
    'walk_right': {'mirror': 'walk_left'},
    'walk_up': {'view': 'rear', 'sequence': 'walk_front'},
}

# Sheet placement: idle frames on rows 0-3 (column 0), walk on rows 4-7.
SHEET_PLACEMENT = {
    'idle_rows': ['idle_down', 'idle_left', 'idle_right', 'idle_up'],
    'walk_rows': ['walk_down', 'walk_left', 'walk_right', 'walk_up'],
}


def _config_fields() -> dict:
    """Allowed value set per config field, so validation is data-driven."""
    return {
        'skin': {'required': True, 'values': list(_merged(bodies.SKINS, 'SKINS').keys())},
        'hair': {'required': True, 'values': list(_merged(hairstyles.HAIRSTYLES, 'HAIRSTYLES').keys())},
        'hair_color': {'required': True, 'values': list(_merged(hairstyles.HAIR_COLORS, 'HAIR_COLORS').keys())},
        'outfit': {'required': True, 'default': 'trousers',
                   'values': list(OUTFITS.keys())},
        'top': {'required': False, 'values': list(_merged(tops.TOP_PALETTES, 'TOP_PALETTES').keys())},
        'pants': {'required': False, 'values': list(_merged(bottoms_shoes.PANTS_PALETTES, 'PANTS_PALETTES').keys())},
        'shoes': {'required': False, 'values': list(_merged(bottoms_shoes.SHOE_PALETTES, 'SHOE_PALETTES').keys())},
        'beard': {'required': False, 'values': list(_merged(beards.BEARDS, 'BEARDS').keys())},
        'beard_color': {'required': False, 'default': 'braun',
                        'values': list(_merged(beards.BEARD_COLORS, 'BEARD_COLORS').keys())},
        'glasses': {'required': False, 'values': list(_merged(accessories.GLASSES_TYPES, 'GLASSES_TYPES').keys())},
        'hat': {'required': False,
                'values': list(_merged(accessories.HATS, 'HATS').keys()) + [HOOD_HAT_VALUE]},
        'misc': {'required': False, 'values': list(_merged(accessories.MISC, 'MISC').keys())},
    }


def _hard_rules() -> dict:
    """Machine-readable combination rules that validation derives from."""
    return {
        'hood': {
            'hat_value': HOOD_HAT_VALUE,
            'replaces': ['hair_front', 'hair_side', 'hair_rear'],
            'excludes_hats': True,
            'requires_top_palette': True,
            'invalid_with_outfits': ['base'],
        },
        # Required non-null config fields per outfit mode (drives validation);
        # derived from the palette-append branches of generate.resolve().
        'required_per_mode': {
            mode: [entry['key'] for entry in PALETTE_COMPOSE['per_mode'][mode]
                   if 'key' in entry]
            for mode in OUTFITS
        },
        'mirror_right_from_left': True,
    }


def build_compose() -> dict:
    return {
        'hood_hat_value': HOOD_HAT_VALUE,
        'base_kit': BASE_KIT,
        'hair_slots': HAIR_SLOTS,
        'outfits': OUTFITS,
        'accessories': ACCESSORIES,
        'palette_compose': PALETTE_COMPOSE,
        'part_layout': PART_LAYOUT,
        'fields': FIELDS,
        'sequences': SEQUENCES,
        'states': STATES,
        'sheet_placement': SHEET_PLACEMENT,
        'config_fields': _config_fields(),
        'hard_rules': _hard_rules(),
    }


def _views(view_dict, symmetric):
    """Serialize a {front, side, rear} grid dict; empty grids stay empty."""
    return {
        'symmetric': symmetric,
        'front': view_dict.get('front', []),
        'side': view_dict.get('side', []),
        'rear': view_dict.get('rear', []),
    }


def _accessory_group(group, symmetric):
    return {name: {**_views(grid, symmetric), 'palette': pal}
            for name, (grid, pal) in group.items()}


def build_catalog() -> dict:
    return {
        'schema': 'meetropolis-sprite-catalog/v5',
        'notice': (
            'Generated output of tools/sprite-generator (the generator sources '
            'are SPDX: AGPL-3.0-only). Tiamat UG holds the copyright in both '
            'the generator and this output and licenses this generated file '
            'under MIT, consistent with the @meetropolis/shared package it '
            'ships in. The generator itself stays AGPL-3.0-only. See '
            'packages/shared/sprite/NOTICE.'
        ),
        'format': {
            'frame_w': engine.FW, 'frame_h': engine.FH,
            'cols': engine.COLS, 'rows': engine.ROWS,
            'sheet_w': engine.SHEET_W, 'sheet_h': engine.SHEET_H,
            'mirror_axis_x': (engine.FW - 1) / 2,
            'sheet_layout': {
                'idle_rows': {'0': 'down', '1': 'left', '2': 'right', '3': 'up'},
                'idle_columns': 'column 0 only; columns 1-3 transparent',
                'walk_rows': {'4': 'down', '5': 'left', '6': 'right', '7': 'up'},
                'walk_columns': '4 frames (contact, pass, contact, pass)',
            },
        },
        'slots': SLOT_LEGEND,
        'render_order_front': [
            'bottom', 'shoes', 'underwear', 'body', 'top', 'hands',
            'face', 'beard', 'glasses', 'hair', 'hat', 'misc',
        ],
        'render_order_side': [
            'leg_back', 'shoe_back', 'bottom_side', 'leg_front', 'shoe_front',
            'body', 'top', 'face', 'beard', 'glasses', 'hair', 'arm', 'hat', 'misc',
        ],
        'render_order_rear': [
            'bottom', 'shoes', 'underwear', 'body', 'top', 'hands',
            'hair', 'hat', 'misc',
        ],
        'choreography': {
            'fps': 8,
            'walk_front': [list(f) for f in poses.WALK_FRONT],
            'walk_side': [list(f) for f in poses.WALK_SIDE],
            'walk_front_fields': ['bob', 'left_shoe_dy', 'right_shoe_dy', 'left_hand_dy', 'right_hand_dy'],
            'walk_side_fields': ['bob', 'front_leg_dx', 'front_leg_dy', 'back_leg_dx', 'back_leg_dy', 'arm_dx'],
        },
        'palettes': {
            'outline': bodies.PAL_COMMON,
            'face': bodies.FACE_COMMON,
            'underwear': bodies.PAL_UNDERWEAR,
            'skin': _merged(bodies.SKINS, 'SKINS'),
            'hair': _merged(hairstyles.HAIR_COLORS, 'HAIR_COLORS'),
            'top': _merged(tops.TOP_PALETTES, 'TOP_PALETTES'),
            'pants': _merged(bottoms_shoes.PANTS_PALETTES, 'PANTS_PALETTES'),
            'shoes': _merged(bottoms_shoes.SHOE_PALETTES, 'SHOE_PALETTES'),
            'beard': _merged(beards.BEARD_COLORS, 'BEARD_COLORS'),
        },
        'catalogs': {
            'hairstyles': {name: _views(v, False) for name, v in _merged(hairstyles.HAIRSTYLES, 'HAIRSTYLES').items()},
            'beards': {name: _views(v, True) for name, v in _merged(beards.BEARDS, 'BEARDS').items()},
            'glasses': _accessory_group(_merged(accessories.GLASSES_TYPES, 'GLASSES_TYPES'), True),
            'hats': _accessory_group(_merged(accessories.HATS, 'HATS'), False),
            'misc': _accessory_group(_merged(accessories.MISC, 'MISC'), False),
            'hood': _views(accessories.HOOD, False),
            'bodies': {
                'body': {'front': bodies.BODY_FRONT, 'side': bodies.BODY_SIDE, 'rear': bodies.BODY_REAR},
                'face': {'front': bodies.FACE_FRONT, 'side': bodies.FACE_SIDE},
                'torso_bare': {'front': bodies.TORSO_BARE_FRONT, 'side': bodies.TORSO_BARE_SIDE, 'rear': bodies.TORSO_BARE_REAR},
                'arm_bare_side': bodies.ARM_BARE_SIDE,
                'underwear': {'front': bodies.UNDERWEAR_FRONT, 'side': bodies.UNDERWEAR_SIDE},
                'legs_bare_full': {
                    'front': bodies.LEGS_BARE_FULL_FRONT,
                    'side_front': bodies.LEG_BARE_FULL_SIDE_FRONT,
                    'side_back': bodies.LEG_BARE_FULL_SIDE_BACK,
                },
                'legs_bare_dress': {
                    'front': bodies.LEGS_BARE_FRONT,
                    'side_front': bodies.LEG_BARE_SIDE_FRONT,
                    'side_back': bodies.LEG_BARE_SIDE_BACK,
                },
                'feet_bare': {
                    'front_l': bodies.FEET_BARE_L, 'front_r': bodies.FEET_BARE_R,
                    'side_front': bodies.FOOT_BARE_SIDE_FRONT, 'side_back': bodies.FOOT_BARE_SIDE_BACK,
                },
            },
            'tops': {
                'trousers': {'front': tops.TOP_FRONT, 'side': tops.TOP_SIDE, 'rear': tops.TOP_REAR},
                'dress': {'front': tops.DRESS_FRONT, 'side': tops.DRESS_SIDE, 'rear': tops.DRESS_REAR},
                'hands': {'front_l': tops.HAND_FRONT_L, 'front_r': tops.HAND_FRONT_R},
                'arms': {'side': tops.ARM_SIDE, 'side_short': tops.ARM_SIDE_SHORT},
            },
            'bottoms': {
                'trousers': {'front': bottoms_shoes.BOTTOM_FRONT, 'side': bottoms_shoes.BOTTOM_SIDE},
                'legs_side': {'front': bottoms_shoes.LEG_SIDE_FRONT, 'back': bottoms_shoes.LEG_SIDE_BACK},
                'shoes': {
                    'front_l': bottoms_shoes.SHOE_FRONT_L, 'front_r': bottoms_shoes.SHOE_FRONT_R,
                    'side_front': bottoms_shoes.SHOE_SIDE_FRONT, 'side_back': bottoms_shoes.SHOE_SIDE_BACK,
                },
            },
        },
        'rules': RULES,
        'compose': build_compose(),
        'defaults': {name: vars(char) for name, char in generate.DEFAULTS.items()},
    }


def _validate_merged_symmetry() -> list:
    """Front-symmetry gate over the MERGED beards + glasses, so additively
    injected EE grids are held to the same rule as the OSS ones."""
    issues = []
    for name, grid in _merged(beards.BEARDS, 'BEARDS').items():
        issues += engine.check_front_symmetry(f'beard:{name}', grid['front'])
    for name, (grid, _pal) in _merged(accessories.GLASSES_TYPES, 'GLASSES_TYPES').items():
        issues += engine.check_front_symmetry(f'glasses:{name}', grid['front'])
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description='Export sprite catalogs to JSON')
    parser.add_argument('--out', default=CATALOG_OUT)
    args = parser.parse_args()

    issues = _validate_merged_symmetry()
    if issues:
        print('merged catalog symmetry check FAILED:', file=sys.stderr)
        for line in issues:
            print(f'  {line}', file=sys.stderr)
        return 1

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as fh:
        json.dump(build_catalog(), fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print(f'wrote {args.out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
