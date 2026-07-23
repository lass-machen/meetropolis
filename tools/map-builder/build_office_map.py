"""
Office map builder.

Generates the three derived tilesheets (office_floor, office_wall, collision)
and writes the office.json (Tiled JSON) that the Meetropolis server seeds
into the default tenant and copies into every tenant at signup.

Sources:
  - apps/web/public/assets/floors/floor_{0..8}.png   (pixel-agents, MIT)
  - apps/web/public/assets/walls/wall_0.png          (pixel-agents, MIT)
  - apps/web/public/assets/furniture/*/*.png         (pixel-agents, MIT)

Outputs:
  - apps/web/public/assets/tilesets/office_floor.png  (144x144, 9 cols x 9 rows)
  - apps/web/public/assets/tilesets/office_wall.png   (64x128, 4 cols x 4 rows, 16x32 cells)
  - apps/web/public/assets/tilesets/collision.png     (16x16)
  - apps/web/public/maps/office.json                  (Tiled JSON)

Deterministic. Re-run the script after editing this file to regenerate; the
output is byte-stable (running twice yields an identical office.json and
identical PNGs).

Design (2026-07 redesign):
  The floor is deliberately CALM. Every cell is the flat sub-tile (column 0)
  of a color variant; zones are painted as solid-color "rugs" (a single muted
  second color), and the small checker sub-tile appears only as a tiny accent
  on the kitchenette coffee counter. The earlier per-cell scatter across the
  grout/brick sub-tiles (which read as noisy white seams) is gone.

  Grundriss (50x40), read from the south entrance upward:
    - Reception at the south entrance (also the spawn point): desk, waiting
      benches, framed plants, welcome mat.
    - Open-plan centre: two bands of four desk pods (pod = two desks + PC +
      chair), greenery between the bands, a clear central concourse.
    - Two enclosed meeting rooms in the top corners (whiteboard + table),
      an open collab bay between them (sofa cluster).
    - Lounge (bottom-left) and kitchenette (bottom-right).

Floor sheet layout (office_floor.png):
  Each row is a colorized variant of the 9 base floor tiles.
  Row 0: warm wood        Row 3: dark walnut     Row 6: cool grey
  Row 1: blue-grey carpet Row 4: light tile      Row 7: soft teal
  Row 2: green carpet     Row 5: caramel accent  Row 8: warm beige
  Sub-tile columns: 0..2 flat fills, 3..4 grout/tile, 5..6 brick,
  7..8 checker. This map uses only column 0 (flat) and column 7 (checker).
  Tile index = variant * 9 + sub (0..8).

Wall sheet layout (autotile bitmask, 4x4 grid of 16x32 pieces):
  bit 0 = N (1), bit 1 = E (2), bit 2 = S (4), bit 3 = W (8)
  index = mask (0..15)
  Verified against pixel-agents upstream by visual inspection.

Object placement convention:
  Tiled stores a tile-object's x,y at the bottom-left in pixel coords. We
  anchor from the top-left tile coordinate and derive the bottom-left pixel
  y as (tile_y + footprint_h) * TILE. Each object carries the seven custom
  properties the server importer consumes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Tuple

from PIL import Image

# -- paths ------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
ASSETS_DIR = REPO_ROOT / "apps" / "web" / "public" / "assets"
FLOORS_DIR = ASSETS_DIR / "floors"
WALLS_DIR = ASSETS_DIR / "walls"
FURNITURE_DIR = ASSETS_DIR / "furniture"
TILESETS_DIR = ASSETS_DIR / "tilesets"
MAPS_DIR = REPO_ROOT / "apps" / "web" / "public" / "maps"

TILE = 16  # base tile size in pixels

# -- map dimensions ---------------------------------------------------------

MAP_W = 50
MAP_H = 40

# -- floor variants ---------------------------------------------------------
# Each variant is described by (hue_deg, saturation_pct, lightness_delta_pct)
# and applied with Photoshop's Hue/Saturation colorize mode, the convention
# pixel-agents documents for this artwork. The row order is load-bearing:
# the map references variants by the named indices below.
FLOOR_VARIANTS: List[Tuple[str, Tuple[float, float, float]]] = [
    ("warm_wood", (30.0, 35.0, -2.0)),
    ("blue_grey_carpet", (215.0, 18.0, 0.0)),
    ("green_carpet", (140.0, 30.0, -4.0)),
    ("dark_walnut", (25.0, 40.0, -22.0)),
    ("light_tile", (210.0, 8.0, 12.0)),
    ("caramel_accent", (35.0, 55.0, -8.0)),
    ("cool_grey", (220.0, 6.0, 4.0)),
    ("soft_teal", (180.0, 22.0, -2.0)),
    ("warm_beige", (40.0, 22.0, 6.0)),
]
NUM_VARIANTS = len(FLOOR_VARIANTS)
SUB_TILES = 9  # 9 source floor tiles per variant

# named variant indices (into FLOOR_VARIANTS)
WARM_WOOD, BLUE_GREY, GREEN, WALNUT, LIGHT, CARAMEL, COOL_GREY, TEAL, BEIGE = range(NUM_VARIANTS)
FLAT_SUB = 0   # calm flat fill sub-tile (column 0)
CHECK_SUB = 7  # small checker sub-tile (column 7), coffee-counter accent only


def colorize_floor(src: Image.Image, hue_deg: float, sat_pct: float, light_delta_pct: float) -> Image.Image:
    """Apply Photoshop-style colorize HSL on a grayscale floor tile.

    The source floor tiles are near-grayscale. We treat each pixel's
    luminance as the lightness, then set hue and saturation as constants
    (colorize semantics) and optionally shift lightness.
    """
    src = src.convert("RGB")
    out = Image.new("RGB", src.size)
    px_in = src.load()
    px_out = out.load()
    h = hue_deg / 360.0
    s = sat_pct / 100.0
    light_delta = light_delta_pct / 100.0
    for y in range(src.height):
        for x in range(src.width):
            r, g, b = px_in[x, y]
            # luminance (Rec. 709) used as lightness baseline
            ly = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
            ly = max(0.0, min(1.0, ly + light_delta))
            rr, gg, bb = hls_to_rgb(h, ly, s)
            px_out[x, y] = (int(rr * 255), int(gg * 255), int(bb * 255))
    return out


def hls_to_rgb(h: float, l: float, s: float) -> Tuple[float, float, float]:
    import colorsys

    return colorsys.hls_to_rgb(h, l, s)


def build_floor_sheet() -> Image.Image:
    """Stitch the 9 source floor tiles into a 9 x NUM_VARIANTS grid.

    Output is (9*16) x (NUM_VARIANTS*16). Each row is one tinted variant.
    """
    sources: List[Image.Image] = []
    for i in range(SUB_TILES):
        sources.append(Image.open(FLOORS_DIR / f"floor_{i}.png").convert("RGB"))
    sheet = Image.new("RGBA", (SUB_TILES * TILE, NUM_VARIANTS * TILE), (0, 0, 0, 0))
    for v_idx, (_name, (h, s, dl)) in enumerate(FLOOR_VARIANTS):
        for sub in range(SUB_TILES):
            tinted = colorize_floor(sources[sub], h, s, dl)
            sheet.paste(tinted, (sub * TILE, v_idx * TILE))
    return sheet


def build_wall_sheet() -> Image.Image:
    """Copy the upstream wall bitmask sheet unchanged (64 x 128)."""
    return Image.open(WALLS_DIR / "wall_0.png").convert("RGBA")


def build_collision_tile() -> Image.Image:
    """16 x 16 translucent red marker."""
    img = Image.new("RGBA", (TILE, TILE), (255, 0, 0, 0))
    # 50%-opaque red interior with a slightly more opaque 1 px border so
    # the marker reads cleanly on top of any floor color.
    for y in range(TILE):
        for x in range(TILE):
            if x == 0 or y == 0 or x == TILE - 1 or y == TILE - 1:
                img.putpixel((x, y), (255, 0, 0, 180))
            else:
                img.putpixel((x, y), (255, 0, 0, 110))
    return img


# -- furniture catalog ------------------------------------------------------


@dataclass(frozen=True)
class FurnitureItem:
    group: str  # group dir name e.g. "DESK"
    file: str   # PNG filename e.g. "DESK_FRONT.png"
    item_id: str  # e.g. "DESK_FRONT"
    width_px: int
    height_px: int
    footprint_w: int
    footprint_h: int
    category: str  # layer category: 'objects' or 'decor'
    collide: bool
    # Strang B: bottom tile rows that collide (0 = full footprint / legacy).
    collision_base_height: int
    # Strang C: client y-sort band ('overhead' for wall art / whiteboards /
    # hanging plants; else 'sorted').
    render_layer: str


def load_furniture_catalog() -> Dict[str, FurnitureItem]:
    """Parse every manifest.json under apps/web/public/assets/furniture/.

    Returns a dict keyed by item_id (e.g. 'DESK_FRONT', 'PC_FRONT_OFF').
    """
    catalog: Dict[str, FurnitureItem] = {}
    for group_dir in sorted(FURNITURE_DIR.iterdir()):
        manifest_path = group_dir / "manifest.json"
        if not manifest_path.exists():
            continue
        m = json.loads(manifest_path.read_text("utf-8"))
        category = m.get("category", "misc")
        # category -> objectgroup classifier
        cls = "decor" if category in ("decor",) else "objects"

        # Render layer (Strang C): wall-mounted items (paintings, whiteboards,
        # clocks, bookshelves, hanging plants) always render above actors.
        render_layer = "overhead" if category == "wall" else "sorted"

        def add_asset(d: dict) -> None:
            file = d.get("file")
            if not file:
                # bare asset (top-level type='asset' with no separate file)
                file = f"{d.get('id', m['id'])}.png"
            item_id = d.get("id", m["id"])
            collide = collides_for(d, m)
            # Collision base height (Strang B): asset override, else manifest
            # default, else 0 (full footprint / legacy).
            collision_base_height = int(d.get("collisionBaseHeight", m.get("collisionBaseHeight", 0)))
            catalog[item_id] = FurnitureItem(
                group=group_dir.name,
                file=file,
                item_id=item_id,
                width_px=int(d.get("width", m.get("width", TILE))),
                height_px=int(d.get("height", m.get("height", TILE))),
                footprint_w=int(d.get("footprintW", m.get("footprintW", 1))),
                footprint_h=int(d.get("footprintH", m.get("footprintH", 1))),
                category=cls,
                collide=collide,
                collision_base_height=collision_base_height,
                render_layer=render_layer,
            )

        def walk(node: dict) -> None:
            t = node.get("type")
            if t == "asset":
                add_asset(node)
                return
            members = node.get("members", []) or []
            for member in members:
                walk(member)

        if m.get("type") == "asset":
            add_asset(m)
        else:
            walk(m)
    return catalog


def collides_for(d: dict, parent: dict) -> bool:
    """Heuristic: tall furniture and wall-mount items don't block; floor
    furniture (desks, chairs, sofas, tables, plants in pots) does.
    """
    cat = parent.get("category", "misc")
    if cat == "wall":
        return False
    item_id = d.get("id") or parent.get("id") or ""
    # Decor that does not block movement: paintings, hangs, clocks
    if cat == "decor":
        # Plants and pots collide; ground markers don't
        if any(token in item_id for token in ("PAINTING", "CLOCK")):
            return False
        return True
    # Surface small-items (misc: BIN, COFFEE) and desktop electronics (PC) sit
    # ON furniture or the floor and must not add invisible blockers on tables /
    # walkways (B-DP7). They never collide.
    if cat in ("misc", "electronics"):
        return False
    return True


# -- floor plan -------------------------------------------------------------


@dataclass
class FloorPlan:
    """Records which floor tile (variant*SUB_TILES + sub) to use per cell."""

    grid: List[List[int]] = field(default_factory=list)  # MAP_H x MAP_W


def base_tile(variant: int, sub: int) -> int:
    return variant * SUB_TILES + sub


# V2 "Sand + blue-grey" floor scheme.
FLOOR_BASE = BEIGE
# rug rectangles (x0, y0, x1, y1, variant), inclusive, painted flat over base
FLOOR_RUGS: List[Tuple[int, int, int, int, int]] = [
    (1, 1, 13, 9, BLUE_GREY),     # meeting room A
    (36, 1, 48, 9, BLUE_GREY),    # meeting room B
    (15, 1, 34, 9, BLUE_GREY),    # collab bay
    (1, 31, 15, 38, COOL_GREY),   # lounge
    (34, 31, 48, 38, LIGHT),      # kitchenette (tiled)
    (20, 33, 29, 38, BLUE_GREY),  # reception welcome mat
]
# checker accent rectangles (x0, y0, x1, y1, variant), using the checker sub
FLOOR_CHECKER: List[Tuple[int, int, int, int, int]] = [
    (45, 31, 48, 32, BLUE_GREY),  # coffee-counter accent
]


def build_floor_plan() -> FloorPlan:
    """Flat base fill + solid-color rug zones + a small checker accent."""
    grid = [[base_tile(FLOOR_BASE, FLAT_SUB) for _ in range(MAP_W)] for _ in range(MAP_H)]
    for (x0, y0, x1, y1, v) in FLOOR_RUGS:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                grid[y][x] = base_tile(v, FLAT_SUB)
    for (x0, y0, x1, y1, v) in FLOOR_CHECKER:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                grid[y][x] = base_tile(v, CHECK_SUB)
    return FloorPlan(grid=grid)


# -- walls ------------------------------------------------------------------

WallSet = set


def build_wall_set() -> WallSet:
    """Perimeter plus the two enclosed meeting rooms; everything else open."""
    walls: WallSet = set()
    # outer perimeter
    for x in range(MAP_W):
        walls.add((x, 0))
        walls.add((x, MAP_H - 1))
    for y in range(MAP_H):
        walls.add((0, y))
        walls.add((MAP_W - 1, y))

    # meeting room A (top-left): interior x1..13, y1..9
    for y in range(0, 11):
        walls.add((14, y))            # right wall
    for x in range(0, 15):
        walls.add((x, 10))            # bottom wall

    # meeting room B (top-right): interior x36..48, y1..9
    for y in range(0, 11):
        walls.add((35, y))            # left wall
    for x in range(35, MAP_W):
        walls.add((x, 10))            # bottom wall

    # doors (2-tile openings)
    doors = [
        (7, 10), (8, 10),                    # meeting A -> open space
        (41, 10), (42, 10),                  # meeting B -> open space
        (24, MAP_H - 1), (25, MAP_H - 1),    # south main entrance
    ]
    for d in doors:
        walls.discard(d)
    return walls


def wall_bitmask(walls: WallSet, x: int, y: int) -> int:
    """Bit 0=N, 1=E, 2=S, 3=W. Only REAL neighbour walls count; the map border
    does NOT. Counting the off-map border as a wall made every perimeter cell
    resolve to mask 14 (south edge) or 15 (corners) — exactly the two tiles that
    carry the anomalous double-riffel band in office_wall.png. Dropping the
    border clauses gives the perimeter a closed cap edge (south 14->10, west
    13->5, corner 15->6) and removes the riffel. Interior walls are unaffected:
    they already derive their mask from real neighbours."""
    mask = 0
    if (x, y - 1) in walls:
        mask |= 1
    if (x + 1, y) in walls:
        mask |= 2
    if (x, y + 1) in walls:
        mask |= 4
    if (x - 1, y) in walls:
        mask |= 8
    return mask


def assert_no_perimeter_riffel(walls: WallSet) -> None:
    """Strang-A guard. The anomalous riffel band came from the off-map border
    being counted as a wall, which turned the perimeter EDGE runs (the whole
    south wall) and the four CORNERS into mask 14 (full south edge) / 15 (full
    corner) — the two defective office_wall.png tiles. After dropping the border
    clauses those cells resolve to clean caps (south 14->10, corners 6/12/3/9).

    NOT checked: the two top-edge cells (14, 0) and (35, 0) where the meeting-
    room right/left walls meet the top perimeter. Those are GENUINE down-T
    junctions (E+S+W real neighbours) and legitimately keep mask 14; the sheet
    defect at that isolated junction is out of scope per A-DP2 (data-only fix).

    Fails the build fast if the south edge or a corner regresses to 14/15."""
    corners = {(0, 0), (MAP_W - 1, 0), (0, MAP_H - 1), (MAP_W - 1, MAP_H - 1)}
    bad: List[Tuple[int, int, int]] = []
    for (x, y) in walls:
        if not (y == MAP_H - 1 or (x, y) in corners):
            continue
        mask = wall_bitmask(walls, x, y)
        if mask in (14, 15):
            bad.append((x, y, mask))
    if bad:
        raise AssertionError(f"south edge / corner regressed to riffel mask 14/15: {bad[:10]}")


# -- furniture placement plan ----------------------------------------------


@dataclass
class Placement:
    item_id: str
    tile_x: int
    tile_y: int
    name: str


def plan_furniture(catalog: Dict[str, FurnitureItem]) -> Tuple[List[Placement], List[Placement]]:
    """Build the (furniture, decor) placement lists. Each Placement is
    anchored at its top-left tile; the catalog footprint fills in the rest.
    """
    f: List[Placement] = []   # -> Furniture layer ("objects")
    d: List[Placement] = []   # -> Decor layer ("decor")

    # ---- Meeting Room A (top-left): x1..13, y1..9 ----
    f.append(Placement("WHITEBOARD", 4, 1, "MeetA_Whiteboard"))
    f.append(Placement("SMALL_TABLE_FRONT", 5, 4, "MeetA_Table"))
    f.append(Placement("CUSHIONED_CHAIR_BACK", 5, 3, "MeetA_ChairN1"))
    f.append(Placement("CUSHIONED_CHAIR_BACK", 6, 3, "MeetA_ChairN2"))
    f.append(Placement("CUSHIONED_CHAIR_FRONT", 5, 6, "MeetA_ChairS1"))
    f.append(Placement("CUSHIONED_CHAIR_FRONT", 6, 6, "MeetA_ChairS2"))
    f.append(Placement("CUSHIONED_CHAIR_SIDE", 4, 4, "MeetA_ChairW"))
    f.append(Placement("CUSHIONED_CHAIR_SIDE", 7, 4, "MeetA_ChairE"))
    d.append(Placement("PLANT", 12, 1, "MeetA_Plant"))
    d.append(Placement("SMALL_PAINTING", 2, 1, "MeetA_Painting"))

    # ---- Meeting Room B (top-right): x36..48, y1..9 ----
    f.append(Placement("WHITEBOARD", 45, 1, "MeetB_Whiteboard"))
    f.append(Placement("SMALL_TABLE_FRONT", 40, 4, "MeetB_Table1"))
    f.append(Placement("SMALL_TABLE_FRONT", 42, 4, "MeetB_Table2"))
    for cx in (40, 41, 42, 43):
        f.append(Placement("CUSHIONED_CHAIR_BACK", cx, 3, f"MeetB_ChairN{cx}"))
        f.append(Placement("CUSHIONED_CHAIR_FRONT", cx, 6, f"MeetB_ChairS{cx}"))
    d.append(Placement("LARGE_PLANT", 46, 6, "MeetB_Plant"))
    d.append(Placement("CLOCK", 37, 1, "MeetB_Clock"))

    # ---- Collab bay (top-center, open): x15..34, y1..9 ----
    f.append(Placement("SOFA_FRONT", 20, 2, "Collab_SofaN1"))
    f.append(Placement("SOFA_FRONT", 22, 2, "Collab_SofaN2"))
    f.append(Placement("COFFEE_TABLE", 21, 4, "Collab_CoffeeTable"))
    f.append(Placement("CUSHIONED_CHAIR_FRONT", 21, 6, "Collab_ChairS1"))
    f.append(Placement("CUSHIONED_CHAIR_FRONT", 22, 6, "Collab_ChairS2"))
    f.append(Placement("SOFA_SIDE", 19, 4, "Collab_SofaW"))
    f.append(Placement("SOFA_SIDE", 24, 4, "Collab_SofaE"))
    d.append(Placement("HANGING_PLANT", 16, 1, "Collab_HangW"))
    d.append(Placement("HANGING_PLANT", 33, 1, "Collab_HangE"))
    d.append(Placement("LARGE_PLANT", 29, 2, "Collab_Plant"))
    d.append(Placement("SMALL_PAINTING_2", 27, 1, "Collab_Painting"))

    # ---- Open plan desk islands: two bands, 4 pods each ----
    # pod = two 3-wide desks with a 1-tile gap; PC on each desk, chair below.
    # The centre aisle (cols 22..26) stays clear as the reception concourse.
    pc_anims = ["PC_FRONT_OFF", "PC_FRONT_ON_1", "PC_FRONT_ON_2", "PC_FRONT_ON_3"]
    pod_x = [3, 15, 27, 39]       # left tile of each pod
    bands = [13, 22]              # desk top rows
    k = 0
    for bi, dy in enumerate(bands):
        for pi, px in enumerate(pod_x):
            for di, dx in enumerate((px, px + 4)):
                f.append(Placement("DESK_FRONT", dx, dy, f"Desk_b{bi}_p{pi}_{di}"))
                pc = pc_anims[k % len(pc_anims)]
                k += 1
                f.append(Placement(pc, dx + 1, dy, f"PC_b{bi}_p{pi}_{di}"))
                f.append(Placement("WOODEN_CHAIR_BACK", dx + 1, dy + 2, f"Chair_b{bi}_p{pi}_{di}"))
    # greenery anchoring each pod between the two bands (gap column)
    for px in pod_x:
        d.append(Placement("PLANT", px + 3, 18, f"PodPlant_{px}"))
    # bookshelf end-caps in the side aisles (not the centre concourse)
    for sx in (11, 36):
        f.append(Placement("DOUBLE_BOOKSHELF", sx, 13, f"OpenBookN_{sx}"))
        f.append(Placement("DOUBLE_BOOKSHELF", sx, 22, f"OpenBookS_{sx}"))
    # side-wall plants flanking the open space
    for py in (12, 18, 26):
        d.append(Placement("PLANT_2", 1, py, f"OpenPlantL_{py}"))
        d.append(Placement("PLANT_2", 48, py, f"OpenPlantR_{py}"))
    # cactus accents in the side aisles
    d.append(Placement("CACTUS", 11, 19, "OpenCactusL"))
    d.append(Placement("CACTUS", 37, 19, "OpenCactusR"))
    # wall art on the meeting-room base walls facing the open space
    d.append(Placement("LARGE_PAINTING", 6, 11, "OpenArtLeft"))
    d.append(Placement("LARGE_PAINTING", 41, 11, "OpenArtRight"))

    # ---- Reception (bottom-center, at the entrance / spawn): x18..31, y32..38 ----
    f.append(Placement("DESK_FRONT", 23, 32, "ReceptionDesk"))
    f.append(Placement("PC_FRONT_ON_1", 24, 32, "ReceptionPC"))
    # receptionist sits behind the desk facing the entrance (south)
    f.append(Placement("WOODEN_CHAIR_FRONT", 24, 30, "ReceptionStaffChair"))
    f.append(Placement("CUSHIONED_BENCH", 20, 35, "ReceptionBenchL1"))
    f.append(Placement("CUSHIONED_BENCH", 21, 35, "ReceptionBenchL2"))
    f.append(Placement("CUSHIONED_BENCH", 28, 35, "ReceptionBenchR1"))
    f.append(Placement("CUSHIONED_BENCH", 29, 35, "ReceptionBenchR2"))
    d.append(Placement("LARGE_PLANT", 18, 33, "ReceptionPlantL"))
    d.append(Placement("LARGE_PLANT", 31, 33, "ReceptionPlantR"))
    d.append(Placement("POT", 22, 37, "ReceptionPotL"))
    d.append(Placement("POT", 27, 37, "ReceptionPotR"))

    # ---- Lounge (bottom-left): x1..15, y31..38 ----
    f.append(Placement("SOFA_FRONT", 3, 32, "LoungeSofaN1"))
    f.append(Placement("SOFA_FRONT", 5, 32, "LoungeSofaN2"))
    f.append(Placement("SOFA_SIDE", 8, 32, "LoungeSofaSide"))
    f.append(Placement("COFFEE_TABLE", 4, 34, "LoungeCoffeeTable"))
    f.append(Placement("CUSHIONED_CHAIR_FRONT", 4, 37, "LoungeChair1"))
    f.append(Placement("CUSHIONED_CHAIR_FRONT", 5, 37, "LoungeChair2"))
    f.append(Placement("BOOKSHELF", 1, 31, "LoungeBookshelf"))
    d.append(Placement("HANGING_PLANT", 13, 31, "LoungeHang"))
    d.append(Placement("LARGE_PAINTING", 10, 31, "LoungeArt"))
    d.append(Placement("LARGE_PLANT", 13, 36, "LoungePlant"))

    # ---- Kitchenette (bottom-right): x34..48, y31..38 ----
    # two social dining tables + a checker-tiled coffee counter in the corner
    f.append(Placement("SMALL_TABLE_FRONT", 36, 34, "KitchenTable1"))
    f.append(Placement("SMALL_TABLE_FRONT", 40, 34, "KitchenTable2"))
    for tx in (36, 40):
        f.append(Placement("CUSHIONED_CHAIR_BACK", tx, 33, f"KitchenChairN1_{tx}"))
        f.append(Placement("CUSHIONED_CHAIR_BACK", tx + 1, 33, f"KitchenChairN2_{tx}"))
        f.append(Placement("CUSHIONED_CHAIR_FRONT", tx, 36, f"KitchenChairS1_{tx}"))
        f.append(Placement("CUSHIONED_CHAIR_FRONT", tx + 1, 36, f"KitchenChairS2_{tx}"))
        f.append(Placement("COFFEE", tx, 34, f"KitchenMug_{tx}"))
    # coffee counter (on the checker accent strip at cols 45..48, rows 31..32)
    f.append(Placement("COFFEE", 45, 32, "KitchenCounterMug1"))
    f.append(Placement("COFFEE", 46, 32, "KitchenCounterMug2"))
    f.append(Placement("COFFEE", 47, 32, "KitchenCounterMug3"))
    f.append(Placement("BIN", 34, 37, "KitchenBin"))
    d.append(Placement("CLOCK", 44, 31, "KitchenClock"))
    d.append(Placement("SMALL_PAINTING", 35, 31, "KitchenArt"))
    d.append(Placement("LARGE_PLANT", 47, 36, "KitchenPlant"))

    return f, d


# -- TMJ serialization ------------------------------------------------------


def serialize_tilesets(
    floor_firstgid: int,
    wall_firstgid: int,
    collision_firstgid: int,
    furniture_firstgids: Dict[str, int],
    catalog: Dict[str, FurnitureItem],
) -> List[dict]:
    sets: List[dict] = []
    sets.append({
        "firstgid": floor_firstgid,
        "columns": SUB_TILES,
        "image": "/assets/tilesets/office_floor.png",
        "imagewidth": SUB_TILES * TILE,
        "imageheight": NUM_VARIANTS * TILE,
        "margin": 0,
        "name": "office_floor",
        "spacing": 0,
        "tilecount": SUB_TILES * NUM_VARIANTS,
        "tileheight": TILE,
        "tilewidth": TILE,
        "type": "tileset",
        "version": "1.10",
    })
    sets.append({
        "firstgid": wall_firstgid,
        "columns": 4,
        "image": "/assets/tilesets/office_wall.png",
        "imagewidth": 64,
        "imageheight": 128,
        "margin": 0,
        "name": "office_wall",
        "spacing": 0,
        "tilecount": 16,
        "tileheight": 32,
        "tilewidth": TILE,
        "type": "tileset",
        "version": "1.10",
    })
    sets.append({
        "firstgid": collision_firstgid,
        "columns": 1,
        "image": "/assets/tilesets/collision.png",
        "imagewidth": TILE,
        "imageheight": TILE,
        "margin": 0,
        "name": "collision",
        "spacing": 0,
        "tilecount": 1,
        "tileheight": TILE,
        "tilewidth": TILE,
        "type": "tileset",
        "version": "1.10",
    })
    # Per-asset object tilesets (one PNG per furniture item). Sort for
    # deterministic firstgid assignment.
    for item_id in sorted(furniture_firstgids.keys()):
        gid = furniture_firstgids[item_id]
        info = catalog[item_id]
        sets.append({
            "firstgid": gid,
            "columns": 1,
            "image": f"/assets/furniture/{info.group}/{info.file}",
            "imagewidth": info.width_px,
            "imageheight": info.height_px,
            "margin": 0,
            "name": f"obj_{item_id}",
            "spacing": 0,
            "tilecount": 1,
            "tileheight": info.height_px,
            "tilewidth": info.width_px,
            "type": "tileset",
            "version": "1.10",
        })
    return sets


def serialize_ground_layer(floor_plan: FloorPlan, floor_firstgid: int) -> dict:
    data: List[int] = []
    for y in range(MAP_H):
        for x in range(MAP_W):
            data.append(floor_plan.grid[y][x] + floor_firstgid)
    return {
        "id": 1,
        "name": "Ground",
        "type": "tilelayer",
        "visible": True,
        "opacity": 1,
        "width": MAP_W,
        "height": MAP_H,
        "x": 0,
        "y": 0,
        "startx": 0,
        "starty": 0,
        "data": data,
    }


def serialize_walls_layer(walls: WallSet, wall_firstgid: int) -> dict:
    data: List[int] = []
    for y in range(MAP_H):
        for x in range(MAP_W):
            if (x, y) in walls:
                mask = wall_bitmask(walls, x, y)
                data.append(wall_firstgid + mask)
            else:
                data.append(0)
    return {
        "id": 2,
        "name": "Walls",
        "type": "tilelayer",
        "visible": True,
        "opacity": 1,
        "width": MAP_W,
        "height": MAP_H,
        "x": 0,
        "y": 0,
        "startx": 0,
        "starty": 0,
        "data": data,
    }


def serialize_collision_layer(
    walls: WallSet,
    placements: List[Placement],
    catalog: Dict[str, FurnitureItem],
    collision_firstgid: int,
) -> dict:
    data: List[int] = [0] * (MAP_W * MAP_H)
    # Walls
    for (x, y) in walls:
        if 0 <= x < MAP_W and 0 <= y < MAP_H:
            data[y * MAP_W + x] = collision_firstgid
    # Every colliding object (furniture AND collidable decor such as floor
    # plants/pots). Only the bottom `collision_base_height` rows are baked as
    # solid (Strang B foot collision) — sentinel 0 = the full footprint. This
    # matches the runtime footprint the server computes via
    # collisionHelpers.computeFootprintTiles(..., collisionBaseHeight), so the
    # baked layer stays in sync with each object's collide flag AND its foot.
    for p in placements:
        info = catalog.get(p.item_id)
        if not info or not info.collide:
            continue
        base = info.collision_base_height
        base_rows = min(base, info.footprint_h) if base > 0 else info.footprint_h
        start_dy = info.footprint_h - base_rows
        for dy in range(start_dy, info.footprint_h):
            for dx in range(info.footprint_w):
                cx = p.tile_x + dx
                cy = p.tile_y + dy
                if 0 <= cx < MAP_W and 0 <= cy < MAP_H:
                    data[cy * MAP_W + cx] = collision_firstgid
    return {
        "id": 5,
        "name": "Collision",
        "type": "tilelayer",
        "visible": True,
        "opacity": 0.5,
        "width": MAP_W,
        "height": MAP_H,
        "x": 0,
        "y": 0,
        "startx": 0,
        "starty": 0,
        "data": data,
    }


def serialize_object(
    obj_id: int,
    placement: Placement,
    catalog: Dict[str, FurnitureItem],
    firstgid: int,
    asset_pack_uuid: str,
    layer_category: str,
) -> dict:
    info = catalog[placement.item_id]
    # Tiled stores object x,y at the **bottom-left** for tile objects. We
    # convert from top-left tile coords: bottom_left_y = (tile_y +
    # footprint_h) * TILE; bottom_left_x = tile_x * TILE.
    px_x = placement.tile_x * TILE
    px_y = (placement.tile_y + info.footprint_h) * TILE
    return {
        "id": obj_id,
        "name": placement.name,
        "type": layer_category,
        "gid": firstgid,
        "x": px_x,
        "y": px_y,
        "width": info.width_px,
        "height": info.height_px,
        "rotation": 0,
        "visible": True,
        "properties": [
            {"name": "assetPackUuid", "type": "string", "value": asset_pack_uuid},
            {"name": "itemId", "type": "string", "value": info.item_id},
            {"name": "category", "type": "string", "value": layer_category},
            {"name": "collide", "type": "bool", "value": info.collide},
            {"name": "tileX", "type": "int", "value": placement.tile_x},
            {"name": "tileY", "type": "int", "value": placement.tile_y},
            {"name": "footprintW", "type": "int", "value": info.footprint_w},
            {"name": "footprintH", "type": "int", "value": info.footprint_h},
            {"name": "collisionBaseHeight", "type": "int", "value": info.collision_base_height},
            {"name": "renderLayer", "type": "string", "value": info.render_layer},
        ],
    }


def serialize_objectgroup(
    layer_id: int,
    layer_name: str,
    layer_category: str,
    placements: List[Placement],
    catalog: Dict[str, FurnitureItem],
    firstgids: Dict[str, int],
    asset_pack_uuid: str,
    obj_id_start: int,
) -> Tuple[dict, int]:
    objects: List[dict] = []
    next_id = obj_id_start
    for p in placements:
        if p.item_id not in catalog:
            raise KeyError(f"unknown furniture item: {p.item_id} (in {p.name})")
        gid = firstgids[p.item_id]
        objects.append(serialize_object(next_id, p, catalog, gid, asset_pack_uuid, layer_category))
        next_id += 1
    return (
        {
            "id": layer_id,
            "name": layer_name,
            "type": "objectgroup",
            "visible": True,
            "opacity": 1,
            "draworder": "topdown",
            "objects": objects,
        },
        next_id,
    )


# -- main -------------------------------------------------------------------


def main() -> None:
    TILESETS_DIR.mkdir(parents=True, exist_ok=True)
    MAPS_DIR.mkdir(parents=True, exist_ok=True)

    print("[build] generating office_floor.png ...")
    build_floor_sheet().save(TILESETS_DIR / "office_floor.png")

    print("[build] generating office_wall.png ...")
    build_wall_sheet().save(TILESETS_DIR / "office_wall.png")

    print("[build] generating collision.png ...")
    build_collision_tile().save(TILESETS_DIR / "collision.png")

    print("[build] loading furniture catalog ...")
    catalog = load_furniture_catalog()
    print(f"[build]   {len(catalog)} furniture items")

    print("[build] planning floor + walls ...")
    plan = build_floor_plan()
    walls = build_wall_set()
    assert_no_perimeter_riffel(walls)

    print("[build] planning furniture + decor ...")
    furniture, decor = plan_furniture(catalog)
    print(f"[build]   furniture: {len(furniture)} / decor: {len(decor)}")

    # firstgids
    floor_firstgid = 1
    wall_firstgid = floor_firstgid + SUB_TILES * NUM_VARIANTS  # 1 + 81 = 82
    collision_firstgid = wall_firstgid + 16  # 82 + 16 = 98
    furniture_firstgid_start = 200
    sorted_ids = sorted(catalog.keys())
    furniture_firstgids = {item_id: furniture_firstgid_start + i for i, item_id in enumerate(sorted_ids)}

    # Spawn = the reception, just inside the south entrance. Stored as pixel
    # coords in the map properties; the server importer copies these into
    # Map.meta.spawn, which the WorldRoom consumes verbatim (pixels).
    spawn_tile_x, spawn_tile_y = 24, 35

    tmj: dict = {
        "compressionlevel": -1,
        "height": MAP_H,
        "width": MAP_W,
        "infinite": False,
        "orientation": "orthogonal",
        "renderorder": "right-down",
        "tiledversion": "1.10.2",
        "type": "map",
        "version": "1.10",
        "tilewidth": TILE,
        "tileheight": TILE,
        "nextlayerid": 6,
        "nextobjectid": 10000,
        "tilesets": serialize_tilesets(
            floor_firstgid, wall_firstgid, collision_firstgid, furniture_firstgids, catalog
        ),
        "layers": [
            serialize_ground_layer(plan, floor_firstgid),
            serialize_walls_layer(walls, wall_firstgid),
        ],
        "properties": [
            {"name": "spawnX", "type": "int", "value": spawn_tile_x * TILE},
            {"name": "spawnY", "type": "int", "value": spawn_tile_y * TILE},
        ],
    }

    asset_pack_uuid = "pixel-agents-furniture"
    next_id = 1000
    furniture_group, next_id = serialize_objectgroup(
        3, "Furniture", "objects", furniture, catalog, furniture_firstgids, asset_pack_uuid, next_id
    )
    decor_group, next_id = serialize_objectgroup(
        4, "Decor", "decor", decor, catalog, furniture_firstgids, asset_pack_uuid, next_id
    )
    tmj["layers"].append(furniture_group)
    tmj["layers"].append(decor_group)
    tmj["layers"].append(serialize_collision_layer(walls, furniture + decor, catalog, collision_firstgid))
    tmj["nextobjectid"] = next_id

    out_path = MAPS_DIR / "office.json"
    out_path.write_text(json.dumps(tmj, indent=2) + "\n", encoding="utf-8")
    print(f"[build] wrote {out_path}")
    print(f"[build] floor firstgid={floor_firstgid}, wall firstgid={wall_firstgid}, collision firstgid={collision_firstgid}")
    print(f"[build] furniture firstgid range: {furniture_firstgid_start}..{furniture_firstgid_start + len(catalog) - 1}")


if __name__ == "__main__":
    main()
