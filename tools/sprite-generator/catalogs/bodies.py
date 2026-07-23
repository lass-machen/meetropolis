# SPDX-License-Identifier: AGPL-3.0-only
"""Body catalog: skin palettes, head/neck grids, face, bare body parts.

Head box front/rear: x=8..23, skull top y6, face y9..18, eyes y12..14
(x=12..13 and 18..19), mouth y16 (x=15..16). Side views face LEFT.
Figure is ~28px tall inside the 32x32 frame.

The bare torso/legs/feet + underwear grids are the editor's starting
point (``base`` outfit) and also supply the naked legs worn under a
dress. On bare skin, no highlight (``a``) pixels sit on silhouette outer
edges — plasticity comes from the ``c`` shadow only (a lesson from the
prototype: stray highlights read as blemishes on darker skin tones).
"""
from engine import layer

# --- outline + skin -------------------------------------------------------
PAL_COMMON = {'O': '#2e222f'}

SKIN_LIGHT = {'a': '#ffdec5', 'b': '#fdcbb0', 'c': '#e09782'}
SKIN_MEDIUM = {'a': '#efbfa6', 'b': '#dd9d80', 'c': '#b7705e'}
SKIN_TAN = {'a': '#dfa088', 'b': '#bd7051', 'c': '#8e4a3b'}
SKIN_DARK = {'a': '#9e6a54', 'b': '#885c47', 'c': '#5a3a2e'}

SKINS = {
    'light': SKIN_LIGHT,
    'medium': SKIN_MEDIUM,
    'tan': SKIN_TAN,
    'dark': SKIN_DARK,
}

# --- face -----------------------------------------------------------------
FACE_COMMON = {'E': '#2e222f', 'W': '#ffffff', 'M': '#c17a5e'}
PAL_UNDERWEAR = {'w': '#d4cdc8', 'x': '#9a8f8a'}

FACE_FRONT = layer({
    10: (12, 'RRR..RRR'),
    12: (12, 'EE....EE'),
    13: (12, 'EW....WE'),
    14: (12, 'EE....EE'),
    16: (15, 'MM'),
})
FACE_SIDE = layer({
    10: (10, 'RRR'),
    12: (10, 'EE'),
    13: (10, 'WE'),
    14: (10, 'EE'),
})

# --- head + neck ----------------------------------------------------------
BODY_FRONT = layer({
    6:  (11, 'OOOOOOOOOO'),
    7:  (10, 'ObbbbbbbbbbO'),
    8:  (9,  'ObbbbbbbbbbbbO'),
    9:  (8,  'ObbbbbbbbbbbbbbO'),
    10: (8,  'OabbbbbbbbbbbbcO'),
    11: (8,  'OabbbbbbbbbbbbcO'),
    12: (8,  'OabbbbbbbbbbbbcO'),
    13: (8,  'ObbbbbbbbbbbbbcO'),
    14: (8,  'ObbbbbbbbbbbbbcO'),
    15: (9,  'ObbbbbbbbbbbcO'),
    16: (10, 'ObbbbbbbbbcO'),
    17: (11, 'ObbbbbbbcO'),
    18: (12, 'OccccccO'),
    19: (13, 'ObbbbO'),
})
BODY_SIDE = layer({
    6:  (11, 'OOOOOOOOOO'),
    7:  (10, 'ObbbbbbbbbbO'),
    8:  (9,  'ObbbbbbbbbbbbO'),
    9:  (9,  'ObbbbbbbbbbbbbO'),
    10: (8,  'OabbbbbbbbbbbbbO'),
    11: (8,  'OabbbbbbbbbbbbbO'),
    12: (8,  'OabbbbbbbbbbbbbO'),
    13: (8,  'ObbbbbbbbbbbbbbO'),
    14: (8,  'ObbbbbbbbbbbbbbO'),
    15: (9,  'ObbbbbbbbbbbbcO'),
    16: (10, 'ObbbbbbbbbbcO'),
    17: (11, 'ObbbbbbbbcO'),
    18: (12, 'OccccccO'),
    19: (13, 'ObbbbO'),
})
# Rear head: full skin (no face), neck patch so it connects to the torso.
BODY_REAR = layer({
    6:  (11, 'OOOOOOOOOO'),
    7:  (10, 'ObbbbbbbbbbO'),
    8:  (9,  'ObbbbbbbbbbbbO'),
    9:  (8,  'ObbbbbbbbbbbbbbO'),
    10: (8,  'ObbbbbbbbbbbbbbO'),
    11: (8,  'ObbbbbbbbbbbbbbO'),
    12: (8,  'ObbbbbbbbbbbbbbO'),
    13: (8,  'ObbbbbbbbbbbbbbO'),
    14: (8,  'ObbbbbbbbbbbbbbO'),
    15: (9,  'ObbbbbbbbbbbbO'),
    16: (10, 'ObbbbbbbbbbO'),
    17: (11, 'ObbbbbbbbO'),
    18: (12, 'OccccccO'),
    19: (13, 'ObbbbO'),
})

# --- bare torso (base outfit + under a dress) -----------------------------
TORSO_BARE_FRONT = layer({
    20: (10, 'ObbbbbbbbbbO'),
    21: (8,  'ObbbbbbbbbbbbccO'),
    22: (8,  'ObbbbbbbbbbbbccO'),
    23: (8,  'ObbbbbbbbbbbbccO'),
    24: (8,  'ObbObbbbbbbbOccO'),
})
TORSO_BARE_SIDE = layer({
    20: (11, 'ObbbbbbbbO'),
    21: (10, 'ObbbbbbbbcO'),
    22: (10, 'ObbbbbbbbcO'),
    23: (10, 'ObbbbbbbccO'),
    24: (11, 'ObbbbbbcO'),
})
TORSO_BARE_REAR = layer({
    20: (10, 'ObbbbbbbbbbO'),
    21: (8,  'ObbbbbbbbbbbcccO'),
    22: (8,  'ObbbbbbbbbbbcccO'),
    23: (8,  'ObbbbbbbbbbbcccO'),
    24: (8,  'ObbObbbbbbbObccO'),
})
ARM_BARE_SIDE = layer({
    22: (13, 'ObcO'),
    23: (13, 'ObcO'),
    24: (13, 'ObcO'),
    25: (14, 'OO'),
})

# --- underwear ------------------------------------------------------------
UNDERWEAR_FRONT = layer({
    25: (10, 'OwwwwwwwwxO'),
    26: (10, 'OwwwwwwwwxO'),
})
UNDERWEAR_SIDE = layer({
    25: (11, 'OwwwwwwxO'),
    26: (11, 'OwwwwwwxO'),
})

# --- bare legs + feet (full-length: base outfit) --------------------------
LEGS_BARE_FULL_FRONT = layer({
    27: (10, 'ObbbO..ObbcO'),
    28: (10, 'ObbbO..ObbcO'),
})
# Front side leg closes at x15 (5px, like the trouser leg OpppO) so no
# 1px slit opens against the back leg when a hem/shoe caps it top+bottom.
LEG_BARE_FULL_SIDE_FRONT = layer({
    27: (11, 'ObbbO'),
    28: (11, 'ObbbO'),
})
LEG_BARE_FULL_SIDE_BACK = layer({
    27: (16, 'ObcO'),
    28: (16, 'ObcO'),
})
FEET_BARE_L = layer({
    29: (10, 'ObbbO'),
    30: (10, 'OOOOO'),
})
FEET_BARE_R = layer({
    29: (17, 'ObbcO'),
    30: (17, 'OOOOO'),
})
FOOT_BARE_SIDE_FRONT = layer({
    29: (10, 'ObbbO'),
    30: (10, 'OOOOO'),
})
FOOT_BARE_SIDE_BACK = layer({
    29: (16, 'ObcO'),
    30: (16, 'OOOO'),
})

# --- bare legs (short: shown under a dress hem) ---------------------------
LEGS_BARE_FRONT = layer({
    28: (11, 'ObbO..ObcO'),
})
LEG_BARE_SIDE_FRONT = layer({
    28: (11, 'ObbbO'),
})
LEG_BARE_SIDE_BACK = layer({
    28: (16, 'ObcO'),
})
