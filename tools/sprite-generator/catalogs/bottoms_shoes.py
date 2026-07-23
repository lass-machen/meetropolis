# SPDX-License-Identifier: AGPL-3.0-only
"""Bottoms + shoes catalog: pants/leg grids, shoe grids, palettes.

Trousers use the ``p/q`` slots (mid/sh); shoes use ``s/r/d`` (mid/hl/sh).
Front and rear share the same leg/shoe layout (``*_FRONT`` grids); the
side view splits into a front and a back leg so they can scissor during
the walk. Shoes are separate parts so a foot can lift a pixel per frame.
"""
from engine import layer

# --- colour palettes ------------------------------------------------------
PANTS_DARK = {'p': '#3f3f4a', 'q': '#28282f'}
PANTS_NAVY = {'p': '#114978', 'q': '#0a2e4c'}

SHOES_BLACK = {'s': '#252525', 'r': '#3a3a3a', 'd': '#141414'}
SHOES_BROWN = {'s': '#6b3a26', 'r': '#a06849', 'd': '#3f2417'}

PANTS_PALETTES = {'dark': PANTS_DARK, 'navy': PANTS_NAVY}
SHOE_PALETTES = {'black': SHOES_BLACK, 'brown': SHOES_BROWN}

# --- pants / legs ---------------------------------------------------------
BOTTOM_FRONT = layer({
    25: (10, 'OppppppppqO'),
    26: (10, 'OppppppppqO'),
    27: (10, 'OpppO..OppqO'),
    28: (10, 'OpppO..OppqO'),
})
BOTTOM_SIDE = layer({
    25: (11, 'OppppppqO'),
    26: (11, 'OppppppqO'),
})
LEG_SIDE_FRONT = layer({
    27: (11, 'OpppO'),
    28: (11, 'OpppO'),
})
LEG_SIDE_BACK = layer({
    27: (16, 'OppqO'),
    28: (16, 'OppqO'),
})

# --- shoes ----------------------------------------------------------------
SHOE_FRONT_L = layer({
    29: (10, 'OrssO'),
    30: (10, 'OOOOO'),
})
SHOE_FRONT_R = layer({
    29: (17, 'OssdO'),
    30: (17, 'OOOOO'),
})
SHOE_SIDE_FRONT = layer({
    29: (10, 'OrsssO'),
    30: (10, 'OOOOOO'),
})
SHOE_SIDE_BACK = layer({
    29: (16, 'OssdO'),
    30: (16, 'OOOOO'),
})
