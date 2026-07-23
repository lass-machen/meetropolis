# SPDX-License-Identifier: AGPL-3.0-only
"""
Meetropolis Spec-Validator
==========================
Prüft 128×256-Character-Spritesheets mechanisch gegen die
Acceptance-Checkliste aus Spec-Anhang B.

Usage:
    python3 validate.py path/to/char_*.png
    python3 validate.py --all   # alle sheets/ überprüfen
"""

from __future__ import annotations
from PIL import Image
import sys
import os
import glob

FW, FH = 32, 32
COLS, ROWS = 4, 8
SHEET_W, SHEET_H = FW * COLS, FH * ROWS   # 128 × 256

MAX_PALETTE = 32

# Empty-cell positions per spec section 2.2: rows 0-3, cols 1-3
EMPTY_CELLS = [(r, c) for r in range(4) for c in range(1, 4)]
# Filled idle cells: rows 0-3 col 0
IDLE_CELLS = [(r, 0) for r in range(4)]
# Walk cells: rows 4-7, cols 0-3 (all)
WALK_CELLS = [(r, c) for r in range(4, 8) for c in range(4)]


class Check:
    def __init__(self):
        self.results = []

    def assert_(self, condition, message):
        self.results.append((bool(condition), message))

    def passed(self):
        return all(ok for ok, _ in self.results)

    def report(self):
        lines = []
        for ok, msg in self.results:
            mark = '✓' if ok else '✗'
            lines.append(f'  {mark} {msg}')
        return '\n'.join(lines)


def cell_bbox(row, col):
    """Return (x0, y0, x1, y1) for given frame cell."""
    return (col * FW, row * FH, (col + 1) * FW, (row + 1) * FH)


def cell_is_fully_transparent(img, row, col):
    x0, y0, x1, y1 = cell_bbox(row, col)
    region = img.crop((x0, y0, x1, y1))
    extrema = region.getextrema()
    # extrema = ((minR,maxR),(minG,maxG),(minB,maxB),(minA,maxA))
    if isinstance(extrema, tuple) and len(extrema) == 4:
        alpha_max = extrema[3][1]
        return alpha_max == 0
    return False


def cell_has_content(img, row, col):
    x0, y0, x1, y1 = cell_bbox(row, col)
    region = img.crop((x0, y0, x1, y1))
    extrema = region.getextrema()
    if isinstance(extrema, tuple) and len(extrema) == 4:
        alpha_max = extrema[3][1]
        return alpha_max > 0
    return False


def count_unique_colors(img):
    """Anzahl eindeutiger nicht-transparenter Farben."""
    colors = set()
    for px in img.getdata():
        if px[3] > 0:  # alpha > 0
            colors.add(px)
    return len(colors)


def _occupied_cells(img):
    """Alle Zellen (row, col) mit mindestens einem opaken Pixel."""
    return [(r, c) for r in range(ROWS) for c in range(COLS)
            if cell_has_content(img, r, c)]


def find_holes(img):
    """Eingeschlossene transparente Pixel über alle belegten Frames.

    Ein transparenter Pixel ist ein Loch, wenn er innerhalb DERSELBEN
    Frame-Zelle vom Zellrand aus über 4er-Nachbarschaft NICHT erreichbar
    ist — der Hintergrund scheint dann mitten durch die Figur. Umgesetzt
    als Flood-Fill vom Rand: was der Rand-Fill nicht erreicht, ist
    eingeschlossen. Natürliche Öffnungen (Beinzwischenraum nach unten
    offen, L-/Stufenkerben mit 4er-Pfad zum Rand) bleiben erreichbar und
    werden korrekt NICHT markiert.
    """
    holes = []
    for row, col in _occupied_cells(img):
        x0, y0, x1, y1 = cell_bbox(row, col)
        cell = img.crop((x0, y0, x1, y1))
        opaque = [[cell.getpixel((x, y))[3] > 0 for x in range(FW)]
                  for y in range(FH)]
        reachable = [[False] * FW for _ in range(FH)]
        stack = []

        def seed(x, y):
            if not opaque[y][x] and not reachable[y][x]:
                reachable[y][x] = True
                stack.append((x, y))

        for x in range(FW):
            seed(x, 0)
            seed(x, FH - 1)
        for y in range(FH):
            seed(0, y)
            seed(FW - 1, y)
        while stack:
            x, y = stack.pop()
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < FW and 0 <= ny < FH:
                    seed(nx, ny)

        for y in range(FH):
            for x in range(FW):
                if not opaque[y][x] and not reachable[y][x]:
                    holes.append((row, col, x, y))
    return holes


def validate(path: str) -> tuple[bool, str]:
    chk = Check()
    if not os.path.exists(path):
        chk.assert_(False, f'Datei existiert: {path}')
        return False, chk.report()

    img = Image.open(path)

    # 1. Format
    chk.assert_(img.mode == 'RGBA', f'PNG-Modus = RGBA (gefunden: {img.mode})')

    # 2. Sheet dimensions
    chk.assert_(img.size == (SHEET_W, SHEET_H),
                f'Sheet-Größe = {SHEET_W}×{SHEET_H} (gefunden: {img.size[0]}×{img.size[1]})')

    if img.size != (SHEET_W, SHEET_H) or img.mode != 'RGBA':
        return chk.passed(), chk.report()

    img = img.convert('RGBA')

    # 3. Idle cells (rows 0-3 col 0) have content
    for r, c in IDLE_CELLS:
        chk.assert_(cell_has_content(img, r, c),
                    f'Idle-Frame row={r} col={c} hat Content')

    # 4. Empty cells (rows 0-3 cols 1-3) sind voll transparent
    for r, c in EMPTY_CELLS:
        chk.assert_(cell_is_fully_transparent(img, r, c),
                    f'Leer-Zelle row={r} col={c} alpha=0')

    # 5. Walk cells alle haben Content
    for r, c in WALK_CELLS:
        chk.assert_(cell_has_content(img, r, c),
                    f'Walk-Frame row={r} col={c} hat Content')

    # 6. Palette-Größe ≤ MAX_PALETTE
    n_colors = count_unique_colors(img)
    chk.assert_(n_colors <= MAX_PALETTE,
                f'Palette-Größe ≤ {MAX_PALETTE} (gefunden: {n_colors})')

    # 7. Frame-Origin alignment — implizit durch cell_bbox
    chk.assert_(SHEET_W % FW == 0 and SHEET_H % FH == 0,
                'Sheet-Dimensionen sind Vielfache der Frame-Größe')

    # 8. Walk-cycle frames sind nicht alle identisch (Animation sichtbar)
    for r in range(4, 8):
        frames = []
        for c in range(4):
            x0, y0, x1, y1 = cell_bbox(r, c)
            frames.append(img.crop((x0, y0, x1, y1)).tobytes())
        unique_frames = len(set(frames))
        chk.assert_(unique_frames >= 2,
                    f'Walk-Row {r}: mind. 2 unterschiedliche Frames (gefunden: {unique_frames}/4)')

    # 9. Idle-direction frames unterscheiden sich (down ≠ up ≠ left ≠ right)
    idle_frames = []
    for r in range(4):
        x0, y0, x1, y1 = cell_bbox(r, 0)
        idle_frames.append(img.crop((x0, y0, x1, y1)).tobytes())
    unique_idles = len(set(idle_frames))
    chk.assert_(unique_idles == 4,
                f'Alle 4 Idle-Direction-Frames sind unterschiedlich (gefunden: {unique_idles}/4)')

    # 10. Keine eingeschlossenen Transparenzlöcher in belegten Frames
    holes = find_holes(img)
    if holes:
        sample = ', '.join(f'r{r}c{c}@({x},{y})' for r, c, x, y in holes[:5])
        detail = f' — z. B. {sample}' + ('...' if len(holes) > 5 else '')
    else:
        detail = ''
    chk.assert_(not holes,
                f'Keine eingeschlossenen Transparenzlöcher (gefunden: {len(holes)}){detail}')

    return chk.passed(), chk.report()


if __name__ == '__main__':
    args = sys.argv[1:]
    if not args or args == ['--all']:
        # default: the six shipped default sprites in the web app
        sprites_dir = os.path.normpath(os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            '..', '..', 'apps', 'web', 'public', 'assets', 'sprites'))
        paths = sorted(glob.glob(os.path.join(sprites_dir, '*.png')))
    else:
        paths = args

    total = len(paths)
    passed_count = 0
    for path in paths:
        print(f'\n── {os.path.basename(path)} ──')
        ok, report = validate(path)
        print(report)
        if ok:
            passed_count += 1
            print('  → PASS')
        else:
            print('  → FAIL')

    print(f'\n══ Summary: {passed_count}/{total} Sheets passed ══')
    sys.exit(0 if passed_count == total else 1)
