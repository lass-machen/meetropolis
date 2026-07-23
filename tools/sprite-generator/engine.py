# SPDX-License-Identifier: AGPL-3.0-only
"""Meetropolis Sprite Generator V4 — rendering engine.

Small, data-agnostic core. Everything visual lives as DATA in the
``catalogs/`` package; this module only knows how to turn character-grid
strings + palettes into pixels and how to lay frames out on a sheet.

Grid model
----------
A *grid* is a list of ``FH`` strings, each ``FW`` characters wide. ``'.'``
means transparent; every other character is a *palette slot* resolved to
an RGBA colour at render time. Grids are authored compactly with
:func:`layer` (``{y: (start_x, content)}``) and padded to the full frame.

Slot legend (shared across catalogs)
------------------------------------
``O`` outline · ``a/b/c`` skin hl/mid/sh · ``E/W/M`` eye/shine/mouth ·
``R`` brow · ``h/i/j`` hair hl/mid/sh · ``t/u/v`` top hl/mid/sh ·
``p/q`` pants mid/sh · ``s/r/d`` shoes · ``w/x`` underwear ·
``e/f/g`` beard hl/mid/sh · uppercase/digits: accessory-private colours.

Sheet format (Meetropolis spec, must stay 128x256)
--------------------------------------------------
4 columns x 8 rows of 32x32 frames. Rows 0-3: idle down/left/right/up
(column 0 only). Rows 4-7: walk, 4 frames, same direction order.
"""
from __future__ import annotations

from PIL import Image

FW = FH = 32
COLS, ROWS = 4, 8
SHEET_W, SHEET_H = FW * COLS, FH * ROWS  # 128 x 256
TRANSPARENT = (0, 0, 0, 0)

# Front mirror axis for symmetry checks: x' = MIRROR_X - x  (x=15.5 centre).
MIRROR_X = FW - 1


def layer(rows: dict) -> list:
    """Author a grid compactly.

    ``rows`` maps ``y`` to ``(start_x, content_string)``. The content is
    padded left/right with ``'.'`` to the full frame width. Overflowing a
    row raises, which turns a mis-typed template into a loud failure
    instead of a silently clipped sprite.
    """
    out = ['.' * FW for _ in range(FH)]
    for y, (x0, content) in rows.items():
        if not 0 <= y < FH:
            raise ValueError(f'row y={y} out of range')
        if x0 < 0 or x0 + len(content) > FW:
            raise ValueError(
                f'row y={y} overflows: x0={x0} len={len(content)} > {FW}'
            )
        out[y] = '.' * x0 + content + '.' * (FW - x0 - len(content))
    return out


def parse_palette(palettes) -> dict:
    """Merge a list of ``{slot: '#rrggbb'}`` dicts into ``{slot: rgba}``.

    Later dicts win on key collisions, mirroring draw-order overrides
    (e.g. the brow slot ``R`` is layered last so it tracks hair colour).
    """
    pal = {}
    for p in palettes:
        for slot, value in p.items():
            hx = value.lstrip('#')
            pal[slot] = (int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16), 255)
    return pal


def render_frame(parts, pal: dict) -> Image.Image:
    """Compose one 32x32 RGBA frame.

    ``parts`` is an ordered list of ``(grid, dx, dy)``. Later parts draw
    over earlier ones; ``dx/dy`` shift a part for walk choreography.
    """
    img = Image.new('RGBA', (FW, FH), TRANSPARENT)
    px = img.putpixel
    for grid, dx, dy in parts:
        for y, row in enumerate(grid):
            ny = y + dy
            if not 0 <= ny < FH:
                continue
            for x, ch in enumerate(row):
                if ch == '.':
                    continue
                nx = x + dx
                if 0 <= nx < FW:
                    px((nx, ny), pal[ch])
    return img


def flip_image(img: Image.Image) -> Image.Image:
    """Mirror a frame horizontally (left-facing view -> right-facing)."""
    return img.transpose(Image.FLIP_LEFT_RIGHT)


def compose_sheet(states: dict) -> Image.Image:
    """Lay per-state frame lists onto the 128x256 spec sheet.

    ``states`` maps each of ``idle_{down,left,right,up}`` (1 frame) and
    ``walk_{down,left,right,up}`` (4 frames) to a list of RGBA frames.
    """
    sheet = Image.new('RGBA', (SHEET_W, SHEET_H), TRANSPARENT)
    idle_order = ['idle_down', 'idle_left', 'idle_right', 'idle_up']
    for r, state in enumerate(idle_order):
        sheet.alpha_composite(states[state][0], (0, r * FH))
    walk_order = ['walk_down', 'walk_left', 'walk_right', 'walk_up']
    for r, state in enumerate(walk_order):
        for c, frame in enumerate(states[state]):
            sheet.alpha_composite(frame, (c * FW, (4 + r) * FH))
    return sheet


def check_front_symmetry(name: str, grid: list) -> list:
    """Return the list of asymmetric pixels of a front grid (empty = OK).

    A face-fixed front layer (beard, glasses) must mirror around x=15.5 in
    BOTH shape and colour: ``row[x] == row[MIRROR_X - x]`` for every pixel.
    Ported from the prototype's ``qa_beards.py`` check.
    """
    issues = []
    for y, row in enumerate(grid):
        for x in range(FW):
            mx = MIRROR_X - x
            if row[x] != row[mx]:
                issues.append(f'{name}: y={y} x={x} "{row[x]}" != x={mx} "{row[mx]}"')
    return issues
