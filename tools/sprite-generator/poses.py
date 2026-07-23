# SPDX-License-Identifier: AGPL-3.0-only
"""Pose choreography: idle + 4-frame walk cycles from a resolved kit.

A *kit* is a flat dict of grids (some ``None``) filling named body slots,
plus a ``hand_swing`` flag. ``generate.py`` builds the kit from a
character config and the catalogs; this module knows only the slot names
and the movement, so trousers, dress and base outfits all run through the
same code. Side views are authored facing LEFT; the right-facing states
are produced by mirroring the rendered left frames in ``generate.py``.

Walk rules (from the prototype, do not "improve" without a review):
  * pass frames tuck the body group +1px DOWN (never up — lifting tore a
    gap between torso and pants).
  * contact frames lift a shoe -1px and swing the hands/arm ±1px.
  * dress puff sleeves disable the vertical hand-swing (``hand_swing``).

Render order (front): bottom -> shoes -> [underwear] -> body -> top ->
hands -> face -> [beard] -> [glasses] -> [hair] -> [hat] -> [misc].
The rear order matches but drops the face-only layers; misc (e.g. a
chain clasp at the neck) is drawn last there too, so it stays visible.
"""
from __future__ import annotations

# (bob, left_shoe_dy, right_shoe_dy, left_hand_dy, right_hand_dy)
WALK_FRONT = [(0, -1, 0, 1, -1), (1, 0, 0, 0, 0), (0, 0, -1, -1, 1), (1, 0, 0, 0, 0)]
IDLE_FRONT = (0, 0, 0, 0, 0)
# (bob, front_leg_dx, front_leg_dy, back_leg_dx, back_leg_dy, arm_dx)
WALK_SIDE = [(0, -2, 0, 2, -1, -1), (1, 0, 0, 0, 0, 0), (0, 1, -1, -1, 0, 1), (1, 0, 0, 0, 0, 0)]
IDLE_SIDE = (0, 0, 0, 0, 0, 0)


def _append(parts, grid, dx, dy):
    if grid is not None:
        parts.append((grid, dx, dy))


def front_parts(kit, bob, lsh, rsh, lha, rha):
    hs = 1 if kit['hand_swing'] else 0
    parts = []
    _append(parts, kit['bottom'], 0, 0)
    _append(parts, kit['shoe_l'], 0, lsh)
    _append(parts, kit['shoe_r'], 0, rsh)
    _append(parts, kit.get('underwear_front'), 0, 0)
    _append(parts, kit['body_front'], 0, bob)
    _append(parts, kit['top_front'], 0, bob)
    _append(parts, kit['hand_l'], 0, bob + lha * hs)
    _append(parts, kit['hand_r'], 0, bob + rha * hs)
    _append(parts, kit['face_front'], 0, bob)
    _append(parts, kit.get('beard_front'), 0, bob)
    _append(parts, kit.get('glasses_front'), 0, bob)
    _append(parts, kit.get('hair_front'), 0, bob)
    _append(parts, kit.get('hat_front'), 0, bob)
    _append(parts, kit.get('misc_front'), 0, bob)
    return parts


def rear_parts(kit, bob, lsh, rsh, lha, rha):
    hs = 1 if kit['hand_swing'] else 0
    parts = []
    _append(parts, kit['bottom'], 0, 0)
    _append(parts, kit['shoe_l'], 0, lsh)
    _append(parts, kit['shoe_r'], 0, rsh)
    _append(parts, kit.get('underwear_front'), 0, 0)
    _append(parts, kit['body_rear'], 0, bob)
    _append(parts, kit['top_rear'], 0, bob)
    _append(parts, kit['hand_l'], 0, bob + lha * hs)
    _append(parts, kit['hand_r'], 0, bob + rha * hs)
    _append(parts, kit.get('hair_rear'), 0, bob)
    _append(parts, kit.get('hat_rear'), 0, bob)
    _append(parts, kit.get('misc_rear'), 0, bob)
    return parts


def side_parts(kit, bob, flx, fly, blx, bly, arm):
    parts = []
    _append(parts, kit['leg_back'], blx, bly)
    _append(parts, kit['shoe_back'], blx, bly)
    _append(parts, kit.get('bottom_side'), 0, 0)
    _append(parts, kit['leg_front'], flx, fly)
    _append(parts, kit['shoe_front'], flx, fly)
    _append(parts, kit['body_side'], 0, bob)
    _append(parts, kit['top_side'], 0, bob)
    _append(parts, kit['face_side'], 0, bob)
    _append(parts, kit.get('beard_side'), 0, bob)
    _append(parts, kit.get('glasses_side'), 0, bob)
    _append(parts, kit.get('hair_side'), 0, bob)
    _append(parts, kit['arm_side'], arm, bob)
    _append(parts, kit.get('hat_side'), 0, bob)
    _append(parts, kit.get('misc_side'), 0, bob)
    return parts


def build_states(kit) -> dict:
    """Return part-lists for the four authored states (down/left/up + walk).

    ``idle_right`` / ``walk_right`` are intentionally absent: the caller
    mirrors the rendered left frames to produce them.
    """
    return {
        'idle_down': [front_parts(kit, *IDLE_FRONT)],
        'idle_left': [side_parts(kit, *IDLE_SIDE)],
        'idle_up':   [rear_parts(kit, *IDLE_FRONT)],
        'walk_down': [front_parts(kit, *f) for f in WALK_FRONT],
        'walk_left': [side_parts(kit, *f) for f in WALK_SIDE],
        'walk_up':   [rear_parts(kit, *f) for f in WALK_FRONT],
    }
