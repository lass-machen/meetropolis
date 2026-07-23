# SPDX-License-Identifier: AGPL-3.0-only
"""Accessory catalog: hats, hood, glasses, misc — grids + palettes.

Each accessory is a dict ``{front, side, rear}`` plus its own palette
(uppercase / digit slots, disjoint from the base lowercase slots).
Combination rules (enforced by the resolver / documented in the JSON
export):
  * A hat draws over the hair top zone (opaque across y3-8) so no hair
    pokes through; long hairstyles still show below it.
  * The hood (``HOOD``) REPLACES the hairstyle and EXCLUDES hats. It uses
    the ``t/u/v`` top slots so it matches the worn garment automatically.
  * Glasses draw between face and hair (hair fringe covers their top).
  * ``schnuller`` / ``zigarette`` are mouth-level; the cigarette hangs
    from the left mouth corner and is intentionally asymmetric.
Hats must read correctly from ALL directions (a prototype rule: e.g. the
beer helmet shows one can on the viewer's side in profile, both in rear).
Side views face LEFT.
"""
from engine import layer

# gold + jewels shared by crown, diadem, chain
PAL_GOLD = {'K': '#f9c22b', 'L': '#dd9a1c', 'N': '#a5680f', 'Y': '#e83b3b', 'Z': '#3a8acd'}

# --- CAP (red baseball cap, brim to the front) ----------------------------
PAL_CAP = {'A': '#e83b3b', 'B': '#ae2334', 'C': '#5e1422'}
CAP = {
    'front': layer({
        3:  (11, 'OOOOOOOOOO'),
        4:  (10, 'OAABBBBBBBBO'),
        5:  (9,  'OAABBBBBBBBBBO'),
        6:  (8,  'OABBBBBBBBBBBBCO'),
        7:  (8,  'OBBBBBBBBBBBBBCO'),
        8:  (8,  'OCCCCCCCCCCCCCCO'),
    }),
    'side': layer({
        3:  (12, 'OOOOOOOO'),
        4:  (11, 'OABBBBBBBO'),
        5:  (10, 'OABBBBBBBBBO'),
        6:  (9,  'OABBBBBBBBBBBO'),
        7:  (9,  'OBBBBBBBBBBBCO'),
        8:  (4,  'OOOOOBCCCCCCCCCCO'),
        9:  (5,  'OOOO'),
    }),
    'rear': layer({
        3:  (11, 'OOOOOOOOOO'),
        4:  (10, 'OABBBBBBBBBO'),
        5:  (9,  'OABBBBBBBBBBBO'),
        6:  (8,  'OABBBBBBBBBBBBCO'),
        7:  (8,  'OBBBBBBBBBBBBBCO'),
        8:  (8,  'OBBBBBOCCOBBBBCO'),
    }),
}

# --- COWBOY (brown hat, wide brim, dented crown) --------------------------
PAL_COWBOY = {'F': '#a06849', 'H': '#6b3a26', 'I': '#3f2417'}
COWBOY = {
    'front': layer({
        2:  (11, 'OOOO..OOOO'),
        3:  (10, 'OFFFOOHHHHHO'),
        4:  (10, 'OFFHHHHHHHHO'),
        5:  (10, 'OFHHHHHHHHIO'),
        6:  (5,  'OOOOOFHHHHHHHHHHOOOOO'),
        7:  (4,  'OFFFFHHHHHHHHHHHHHHIIIO'),
        8:  (5,  'OOOOOIIIIIIIIIIOOOOO'),
    }),
    'side': layer({
        2:  (12, 'OOO..OOO'),
        3:  (11, 'OFFOOHHHO'),
        4:  (11, 'OFHHHHHHHO'),
        5:  (11, 'OFHHHHHHHIO'),
        6:  (6,  'OOOOOFHHHHHHHHHOOOO'),
        7:  (5,  'OFFFHHHHHHHHHHHHHIIO'),
        8:  (6,  'OOOOIIIIIIIIIIIOOO'),
    }),
    'rear': layer({
        2:  (11, 'OOOO..OOOO'),
        3:  (10, 'OFFFOOHHHHHO'),
        4:  (10, 'OFFHHHHHHHHO'),
        5:  (10, 'OFHHHHHHHHIO'),
        6:  (5,  'OOOOOFHHHHHHHHHHOOOOO'),
        7:  (4,  'OFFFFHHHHHHHHHHHHHHIIIO'),
        8:  (5,  'OOOOOIIIIIIIIIIOOOOO'),
    }),
}

# --- ZYLINDER (top hat: tall tube + red band + brim) ----------------------
PAL_ZYLINDER = {'P': '#45415a', 'Q': '#28243a', 'T': '#ae2334'}
ZYLINDER = {
    'front': layer({
        0:  (10, 'OOOOOOOOOOOO'),
        1:  (10, 'OPPQQQQQQQQO'),
        2:  (10, 'OPPQQQQQQQQO'),
        3:  (10, 'OPPQQQQQQQQO'),
        4:  (10, 'OPQQQQQQQQQO'),
        5:  (10, 'OTTTTTTTTTTO'),
        6:  (10, 'OQQQQQQQQQQO'),
        7:  (8,  'OOPPQQQQQQQQQQOO'),
        8:  (8,  'OOOOOOOOOOOOOOOO'),
    }),
    'side': layer({
        0:  (11, 'OOOOOOOOOO'),
        1:  (11, 'OPPQQQQQQO'),
        2:  (11, 'OPPQQQQQQO'),
        3:  (11, 'OPPQQQQQQO'),
        4:  (11, 'OPQQQQQQQO'),
        5:  (11, 'OTTTTTTTTO'),
        6:  (11, 'OQQQQQQQQO'),
        7:  (9,  'OOPQQQQQQQQOO'),
        8:  (9,  'OOOOOOOOOOOOO'),
    }),
    'rear': layer({
        0:  (10, 'OOOOOOOOOOOO'),
        1:  (10, 'OPPQQQQQQQQO'),
        2:  (10, 'OPPQQQQQQQQO'),
        3:  (10, 'OPPQQQQQQQQO'),
        4:  (10, 'OPQQQQQQQQQO'),
        5:  (10, 'OTTTTTTTTTTO'),
        6:  (10, 'OQQQQQQQQQQO'),
        7:  (8,  'OOPPQQQQQQQQQQOO'),
        8:  (8,  'OOOOOOOOOOOOOOOO'),
    }),
}

# --- KRONE (gold crown: hair shows between the spikes on purpose) ---------
KRONE = {
    'front': layer({
        2:  (10, 'K....ZZ....K'),
        3:  (10, 'KN...KN...KN'),
        4:  (10, 'KN...KN...KN'),
        5:  (10, 'KKKKKKKKKKKL'),
        6:  (10, 'LLLLLLLLLLNN'),
    }),
    'side': layer({
        2:  (11, 'K....ZZ'),
        3:  (11, 'KN...KN'),
        4:  (11, 'KN...KN'),
        5:  (11, 'KKKKKKKKKL'),
        6:  (11, 'LLLLLLLLNN'),
    }),
    'rear': layer({
        3:  (10, 'KN...KN...KN'),
        4:  (10, 'KN...KN...KN'),
        5:  (10, 'KKKKKKKKKKKL'),
        6:  (10, 'LLLLLLLLLLNN'),
    }),
}

# --- DIADEM (thin gold arc, blue jewel in the middle) ---------------------
DIADEM = {
    'front': layer({
        4:  (15, 'ZZ'),
        5:  (11, 'KKK.KK.KKK'),
    }),
    'side': layer({
        4:  (12, 'ZZ'),
        5:  (11, 'KKK.KK'),
    }),
    'rear': layer({
        5:  (11, 'KK......KK'),
    }),
}

# --- BIERHELM (red helmet, one can each side, straws to the mouth) --------
PAL_BIERHELM = {'A': '#e83b3b', 'B': '#ae2334', 'C': '#5e1422',
                'U': '#f9c22b', 'V': '#dd9a1c', 'S': '#d4cdc8'}
BIERHELM = {
    'front': layer({
        2:  (11, 'OOOOOOOOOO'),
        3:  (10, 'OABBBBBBBBBO'),
        4:  (6,  'OOOOABBBBBBBBBBOOOO'),
        5:  (5,  'OUUOOABBBBBBBBBBOOUUO'),
        6:  (5,  'OUUOOOBBBBBBBBBBOOOUUO'),
        7:  (5,  'OUVOOOCCCCCCCCCCOOOUVO'),
        8:  (5,  'OOOO..............OOOO'),
        9:  (7,  'S................S'),
        10: (7,  'S................S'),
        11: (7,  'S................S'),
        12: (7,  'S................S'),
        13: (7,  'S................S'),
        14: (7,  'S................S'),
        15: (8,  'SS............SS'),
        16: (10, 'SS........SS'),
    }),
    'side': layer({
        2:  (12, 'OOOOOOOO'),
        3:  (11, 'OABBBBBBBBO'),
        4:  (10, 'OABOOOOOBBBBO'),
        5:  (9,  'OABBOUUVOBBBBO'),
        6:  (9,  'OBBBOUUVOBBBBO'),
        7:  (9,  'OCCCOUUVOCCCCO'),
        8:  (9,  'OOOOOUUVOOOOOO'),
        9:  (13, 'OUUVO'),
        10: (13, 'OOOOO'),
        11: (10, 'S'),
        12: (9,  'S'),
        13: (8,  'S'),
        14: (8,  'S'),
        15: (8,  'S'),
        16: (9,  'S'),
    }),
    'rear': layer({
        2:  (11, 'OOOOOOOOOO'),
        3:  (10, 'OABBBBBBBBBO'),
        4:  (6,  'OOOOABBBBBBBBBBOOOO'),
        5:  (5,  'OUUOOABBBBBBBBBBOOUUO'),
        6:  (5,  'OUUOOOBBBBBBBBBBOOOUUO'),
        7:  (5,  'OUVOOOCCCCCCCCCCOOOUVO'),
        8:  (5,  'OOOO..............OOOO'),
    }),
}

# --- KAPUZE (hood: replaces hair, coloured like the top via t/u/v) --------
HOOD = {
    'front': layer({
        3:  (12, 'OOOOOOOO'),
        4:  (10, 'OOttuuuuuuOO'),
        5:  (9,  'OttuuuuuuuuuO'),
        6:  (8,  'OttuuuuuuuuuuvvO'),
        7:  (8,  'OtuuuuuuuuuuuvvO'),
        8:  (8,  'OtOO........OOvO'),
        9:  (8,  'OuO..........OvO'),
        10: (8,  'OuO..........OvO'),
        11: (8,  'OuO..........OvO'),
        12: (8,  'OuO..........OvO'),
        13: (8,  'OuO..........OvO'),
        14: (8,  'OuO..........OvO'),
        15: (8,  'OuO..........OvO'),
        16: (8,  'OuO..........OvO'),
        17: (8,  'OuOO........OOvO'),
        18: (9,  'OuOOOOOOOOOOvO'),
        19: (9,  'OOuuuuuuuuuvOO'),
    }),
    'side': layer({
        3:  (13, 'OOOOOOO'),
        4:  (11, 'OOttuuuuOO'),
        5:  (10, 'OttuuuuuuuuO'),
        6:  (9,  'OtuuuuuuuuuuuvO'),
        7:  (8,  'OtuuuuuuuuuuuvvO'),
        8:  (8,  'O...OOuuuuuuuvvO'),
        9:  (8,  'O....OuuuuuuuvvO'),
        10: (8,  'O....OuuuuuuuvvO'),
        11: (8,  'O....OuuuuuuuvvO'),
        12: (8,  'O....OuuuuuuuvvO'),
        13: (8,  'O....OuuuuuuvvvO'),
        14: (8,  'O....OuuuuuvvvOO'),
        15: (13, 'OOuuuuvvOO'),
        16: (13, 'OOuuuvvOO'),
        17: (13, 'OOuuvvOO'),
        18: (11, 'OuuuuuvvO'),
        19: (11, 'OOuuuvOO'),
    }),
    'rear': layer({
        3:  (12, 'OOOOOOOO'),
        4:  (10, 'OOttuuuuuuOO'),
        5:  (9,  'OttuuuuuuuuuO'),
        6:  (8,  'OttuuuuuuuuuuvO'),
        7:  (8,  'OtuuuuuuuuuuuvO'),
        8:  (8,  'OtuuuuuuuuuuvvO'),
        9:  (8,  'OuuuuuvvuuuuvvO'),
        10: (8,  'OuuuuuvvuuuuvvO'),
        11: (8,  'OuuuuuvvuuuuvvO'),
        12: (8,  'OuuuuuvvuuuvvvO'),
        13: (8,  'OuuuuuuuuuuvvvO'),
        14: (8,  'OuuuuuuuuuuvvvO'),
        15: (8,  'OuuuuuuuuuuvvvO'),
        16: (8,  'OuuuuuuuuuvvvvO'),
        17: (8,  'OuuuuuuuuuvvvvO'),
        18: (9,  'OuuuuuuuuvvvvO'),
        19: (9,  'OOuuuuuuuvvOO'),
    }),
}

# --- GLASSES: rect, round, mad-professor ----------------------------------
PAL_GLASS_DARK = {'G': '#3a3440'}
PAL_PROF = {'G': '#8d8580', '1': '#d4e5ee', '2': '#9ec3d8'}

GLASSES_RECT = {
    'front': layer({
        11: (11, 'GGGG..GGGG'),
        12: (11, 'G..GGGG..G'),
        13: (11, 'G..G..G..G'),
        14: (11, 'GGGG..GGGG'),
    }),
    'side': layer({
        11: (9,  'GGGG'),
        12: (9,  'G..G'),
        13: (9,  'GGGG'),
    }),
    'rear': layer({}),
}
GLASSES_ROUND = {
    'front': layer({
        11: (12, 'GG....GG'),
        12: (11, 'G..GGGG..G'),
        13: (11, 'G..G..G..G'),
        14: (12, 'GG....GG'),
    }),
    'side': layer({
        11: (10, 'GG'),
        12: (9,  'G..G'),
        13: (10, 'GG'),
    }),
    'rear': layer({}),
}
# Mad-professor lenses: thick frame with a symmetric double glint. Row 13
# mirrors row 12's glint so both lenses match around x=15.5 (front-symmetry
# check treats glasses as a face-fixed symmetric layer).
GLASSES_PROF = {
    'front': layer({
        10: (11, 'GGGG..GGGG'),
        11: (11, 'G11GGGG11G'),
        12: (11, 'G121GG121G'),
        13: (11, 'G112GG211G'),
        14: (11, 'GGGG..GGGG'),
    }),
    'side': layer({
        10: (9,  'GGGG'),
        11: (9,  'G11G'),
        12: (9,  'G21G'),
        13: (9,  'GGGG'),
    }),
    'rear': layer({}),
}

# --- MISC: chain, pacifier, cigarette -------------------------------------
KETTE = {
    'front': layer({
        20: (11, 'LL......LL'),
        21: (12, 'LL....LL'),
        22: (14, 'L..L'),
        23: (15, 'KK'),
    }),
    'side': layer({
        20: (11, 'LLL'),
        21: (12, 'LL'),
    }),
    'rear': layer({
        20: (11, 'LLLLLLLLLL'),
    }),
}
PAL_SCHNULLER = {'3': '#5ab9e8', '4': '#2a7fb8', '5': '#ffffff'}
SCHNULLER = {
    'front': layer({
        15: (14, '.33.'),
        16: (13, '334433'),
        17: (14, '.55.'),
    }),
    'side': layer({
        15: (9,  '33'),
        16: (8,  '3443'),
        17: (9,  '55'),
    }),
    'rear': layer({}),
}
# Hangs from the left mouth corner, pointing down-left, ember at the lower
# end (no smoke — it would sit on the face). Intentionally asymmetric.
PAL_ZIGARETTE = {'6': '#e8e2dc', '7': '#f79617', '8': '#9a8f8a'}
ZIGARETTE = {
    'front': layer({
        16: (13, '66'),
        17: (11, '766'),
    }),
    'side': layer({
        16: (8,  '66'),
        17: (6,  '76'),
    }),
    'rear': layer({}),
}

HATS = {
    'cap': (CAP, PAL_CAP),
    'cowboy': (COWBOY, PAL_COWBOY),
    'zylinder': (ZYLINDER, PAL_ZYLINDER),
    'krone': (KRONE, PAL_GOLD),
    'diadem': (DIADEM, PAL_GOLD),
    'bierhelm': (BIERHELM, PAL_BIERHELM),
}
GLASSES_TYPES = {
    'rect': (GLASSES_RECT, PAL_GLASS_DARK),
    'round': (GLASSES_ROUND, PAL_GLASS_DARK),
    'prof': (GLASSES_PROF, PAL_PROF),
}
MISC = {
    'kette': (KETTE, PAL_GOLD),
    'schnuller': (SCHNULLER, PAL_SCHNULLER),
    'zigarette': (ZIGARETTE, PAL_ZIGARETTE),
}
HOOD_PAIR = (HOOD, {})  # hood recolours from the worn top's t/u/v slots
