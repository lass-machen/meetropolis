# SPDX-License-Identifier: AGPL-3.0-only
"""Facial-hair catalog: mustache, full beard, goatee + colours.

Own slots ``e/f/g`` (hl/mid/sh) so beard colour is independent of hair
colour. Drawn after the face, below the hairline; not visible from the
rear. Every front grid MUST be shape- AND colour-symmetric around x=15.5
(mirror x' = 31 - x); the generator aborts otherwise. Learned the hard
way: an asymmetric mouth row made the full beard look off-centre.
"""
from engine import layer

BEARD_BROWN = {'e': '#9e4539', 'f': '#6b3a26', 'g': '#3f2417'}
BEARD_BLACK = {'e': '#45293f', 'f': '#2e222f', 'g': '#1a1420'}
BEARD_BLOND = {'e': '#f9c22b', 'f': '#f79617', 'g': '#cd683d'}
BEARD_GREY = {'e': '#d4cdc8', 'f': '#9a8f8a', 'g': '#665d58'}

BEARD_COLORS = {
    'braun': BEARD_BROWN,
    'schwarz': BEARD_BLACK,
    'blond': BEARD_BLOND,
    'grau': BEARD_GREY,
}

# --- SCHNAUZER — drooping horseshoe under the nose ------------------------
MUSTACHE = {
    'front': layer({
        15: (14, 'fggf'),
        16: (13, 'gf..fg'),
    }),
    'side': layer({
        15: (9,  'ff'),
        16: (10, 'fg'),
    }),
    'rear': layer({}),
}

# --- VOLLBART — cheeks to chin, mouth opening centred on x=15.5 -----------
FULL_BEARD = {
    'front': layer({
        13: (9,  'g............g'),
        14: (9,  'gf..........fg'),
        15: (9,  'gffffffffffffg'),
        16: (10, 'gff......ffg'),
        17: (10, 'gffffffffffg'),
        18: (11, 'gffffffffg'),
        19: (12, 'gffffffg'),
        20: (14, 'gffg'),
    }),
    'side': layer({
        13: (9,  'g'),
        14: (9,  'gf'),
        15: (9,  'gfffg'),
        16: (9,  'gff'),
        17: (9,  'gffff'),
        18: (10, 'gffffg'),
        19: (11, 'gffg'),
    }),
    'rear': layer({}),
}

# --- ZIEGENBART — chin-only wedge, tapering to a dark tip -----------------
GOATEE = {
    'front': layer({
        17: (14, 'gffg'),
        18: (15, 'ff'),
        19: (15, 'gg'),
    }),
    'side': layer({
        17: (11, 'ff'),
        18: (12, 'ff'),
        19: (12, 'g'),
    }),
    'rear': layer({}),
}

BEARDS = {
    'schnauzer': MUSTACHE,
    'vollbart': FULL_BEARD,
    'ziegenbart': GOATEE,
}
