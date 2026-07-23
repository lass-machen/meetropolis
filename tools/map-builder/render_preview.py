"""
Offline preview renderer for office.json.

Composites the floor, walls and furniture/decor object layers into a
single PNG, scaled 4x for inspection. Does not run Phaser; does not need
the dev server. The output file is gitignored.

Usage:
  python render_preview.py [path/to/office.json]   # default: ../../apps/web/public/maps/office.json
  Output: ./office_preview.png
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
WEB_PUBLIC = REPO_ROOT / "apps" / "web" / "public"

DEFAULT_TMJ = WEB_PUBLIC / "maps" / "office.json"

SCALE = 4


def resolve_public(url: str) -> Path:
    """Resolve a public absolute URL (e.g. '/assets/foo.png') to a path."""
    if url.startswith("/"):
        return WEB_PUBLIC / url.lstrip("/")
    return Path(url)


def load_image_set(tilesets: List[dict]) -> Dict[int, Tuple[Image.Image, dict]]:
    """Return a mapping from firstgid -> (image, tileset_dict).

    Each tileset PNG is loaded once; the caller picks the correct subtile
    by gid offset.
    """
    by_first: Dict[int, Tuple[Image.Image, dict]] = {}
    for ts in tilesets:
        img = Image.open(resolve_public(ts["image"])).convert("RGBA")
        by_first[ts["firstgid"]] = (img, ts)
    return by_first


def find_tileset_for_gid(gid: int, sets: Dict[int, Tuple[Image.Image, dict]]) -> Optional[Tuple[Image.Image, dict, int]]:
    if gid <= 0:
        return None
    chosen_first: Optional[int] = None
    for first in sorted(sets.keys()):
        if gid >= first:
            chosen_first = first
        else:
            break
    if chosen_first is None:
        return None
    img, ts = sets[chosen_first]
    return img, ts, gid - chosen_first


def crop_tile(img: Image.Image, ts: dict, idx: int) -> Image.Image:
    cols = ts.get("columns") or 1
    tw = ts["tilewidth"]
    th = ts["tileheight"]
    cx = idx % cols
    cy = idx // cols
    return img.crop((cx * tw, cy * th, cx * tw + tw, cy * th + th))


def render_tile_layer(canvas: Image.Image, layer: dict, sets: Dict[int, Tuple[Image.Image, dict]], tile: int) -> None:
    w = layer["width"]
    h = layer["height"]
    data = layer["data"]
    for y in range(h):
        for x in range(w):
            gid = data[y * w + x]
            r = find_tileset_for_gid(gid, sets)
            if r is None:
                continue
            img, ts, idx = r
            tile_img = crop_tile(img, ts, idx)
            # Wall pieces are 16x32; the canvas tile cell is 16x16. Walls
            # render bottom-aligned to the cell (their "anchor" is the
            # bottom of the cell since they are taller than they are wide).
            pos_x = x * tile
            pos_y = y * tile
            if tile_img.height > tile:
                pos_y -= tile_img.height - tile
            canvas.alpha_composite(tile_img, (pos_x, pos_y))


def render_object_layer(canvas: Image.Image, layer: dict, sets: Dict[int, Tuple[Image.Image, dict]], tile: int) -> None:
    # Tiled tile-objects: x,y is bottom-left in pixel coords.
    for obj in layer.get("objects", []):
        gid = obj.get("gid", 0)
        r = find_tileset_for_gid(gid, sets)
        if r is None:
            continue
        img, ts, idx = r
        tile_img = crop_tile(img, ts, idx)
        px = int(obj["x"])
        py = int(obj["y"]) - tile_img.height
        canvas.alpha_composite(tile_img, (px, py))


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_TMJ
    tmj = json.loads(src.read_text("utf-8"))
    tile = tmj["tilewidth"]
    w_tiles = tmj["width"]
    h_tiles = tmj["height"]
    canvas = Image.new("RGBA", (w_tiles * tile, h_tiles * tile), (40, 40, 40, 255))

    sets = load_image_set(tmj["tilesets"])

    # Render order: ground, walls, furniture (objects, sort by y), decor.
    for layer in tmj["layers"]:
        if layer["name"] == "Collision":
            continue
        if layer["type"] == "tilelayer":
            render_tile_layer(canvas, layer, sets, tile)
        elif layer["type"] == "objectgroup":
            # painter sort by bottom-y for stable overlap
            layer_objs = sorted(layer.get("objects", []), key=lambda o: o["y"])
            render_object_layer(canvas, {**layer, "objects": layer_objs}, sets, tile)

    # Scale up for inspection
    final = canvas.resize((canvas.width * SCALE, canvas.height * SCALE), Image.NEAREST)
    out = Path(__file__).parent / "office_preview.png"
    final.save(out)
    print(f"[render] wrote {out} ({final.size[0]} x {final.size[1]})")


if __name__ == "__main__":
    main()
