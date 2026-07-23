# SPDX-License-Identifier: AGPL-3.0-only
"""Top catalog: torso garments (trousers outfit + dress) and palettes.

Two garment SHAPES share every colour palette below:
  * the trousers-outfit top (``TOP_*`` grids) — a plain torso with a
    sleeve seam and a sleeve extension on the hand row (y24). The
    extension is normally hidden by the hand and only shows during the
    walk hand-swing, which closes the gap that used to open between a
    fixed sleeve and a lifting hand.
  * the ``DRESS_*`` grids — the same torso flaring into a hem over bare
    legs; its short puff sleeves disable the vertical hand-swing.

Hands (``HAND_*``) carry skin slots ``b/c`` so they recolour with the
body. Side views face LEFT. All garment colours use the ``t/u/v`` slots
(hl/mid/sh), so a dress colour is just another top palette.
"""
from engine import layer

# --- colour palettes ------------------------------------------------------
TOP_SHIRT_WHITE = {'t': '#ffffff', 'u': '#e8e2dc', 'v': '#b8aea4'}
TOP_HOODIE_BLUE = {'t': '#3a8acd', 'u': '#1164a9', 'v': '#0a3a6a'}
TOP_SUIT_NAVY = {'t': '#2d4a63', 'u': '#1f3447', 'v': '#122638'}
TOP_BLAZER_ANTHRACITE = {'t': '#4a4a55', 'u': '#33333d', 'v': '#22222b'}
DRESS_RED = {'t': '#e83b3b', 'u': '#ae2334', 'v': '#7a1a28'}

TOP_PALETTES = {
    'shirt_white': TOP_SHIRT_WHITE,
    'hoodie_blue': TOP_HOODIE_BLUE,
    'suit_navy': TOP_SUIT_NAVY,
    'blazer_anthracite': TOP_BLAZER_ANTHRACITE,
    'dress_red': DRESS_RED,
}

# --- trousers-outfit torso ------------------------------------------------
TOP_FRONT = layer({
    20: (10, 'OuuuuuuuuuuO'),
    21: (8,  'OttvuuuuuuuuvvvO'),
    22: (8,  'OttvuuuuuuuuvvvO'),
    23: (8,  'OuuvuuuuuuuuvvvO'),
    24: (8,  'OuuOuuuuuuuuOvvO'),
})
TOP_SIDE = layer({
    20: (11, 'OuuuuuuuuO'),
    21: (10, 'OtuuuuuuuvO'),
    22: (10, 'OtuuuuuuuvO'),
    23: (10, 'OuuuuuuuvvO'),
    24: (11, 'OuuuuuuvO'),
})
TOP_REAR = layer({
    20: (10, 'OuuuuuuuuuuO'),
    21: (8,  'OttvuuuuuuuuvvvO'),
    22: (8,  'OttvuuuuuuuvvvvO'),
    23: (8,  'OuuvuuuuuuuvvvvO'),
    24: (8,  'OuuOuuuuuuuOvvvO'),
})

# --- hands (skin) + swinging side arm -------------------------------------
HAND_FRONT_L = layer({
    24: (8, 'ObbO'),
    25: (9, 'OO'),
})
HAND_FRONT_R = layer({
    24: (20, 'OccO'),
    25: (21, 'OO'),
})
ARM_SIDE = layer({
    22: (13, 'OuvO'),
    23: (13, 'OuvO'),
    24: (13, 'ObcO'),
    25: (14, 'OO'),
})

# --- dress ----------------------------------------------------------------
DRESS_FRONT = layer({
    20: (10, 'OuuuuuuuuuuO'),
    21: (8,  'OttvuuuuuuuuvvvO'),
    22: (8,  'OttvuuuuuuuuvvvO'),
    23: (8,  'OuuvuuuuuuuuvvvO'),
    24: (10, 'OtuuuuuuuvvO'),
    25: (9,  'OtuuuuuuuuuvvO'),
    26: (9,  'OuuuuuuuuuuvvO'),
    27: (9,  'OOOOOOOOOOOOOO'),
})
DRESS_SIDE = layer({
    20: (11, 'OuuuuuuuuO'),
    21: (10, 'OtuuuuuuuvO'),
    22: (10, 'OtuuuuuuuvO'),
    23: (10, 'OuuuuuuuvvO'),
    24: (10, 'OtuuuuuuvvO'),
    25: (9,  'OtuuuuuuuvvO'),
    26: (9,  'OuuuuuuuuvvO'),
    27: (9,  'OOOOOOOOOOOO'),
})
DRESS_REAR = layer({
    20: (10, 'OuuuuuuuuuuO'),
    21: (8,  'OttvuuuuuuuuvvvO'),
    22: (8,  'OttvuuuuuuuvvvvO'),
    23: (8,  'OuuvuuuuuuuvvvvO'),
    24: (10, 'OtuuuuuuvvvO'),
    25: (9,  'OtuuuuuuuuvvvO'),
    26: (9,  'OuuuuuuuuuvvvO'),
    27: (9,  'OOOOOOOOOOOOOO'),
})
ARM_SIDE_SHORT = layer({
    22: (13, 'OuvO'),
    23: (13, 'ObcO'),
    24: (14, 'OO'),
})
