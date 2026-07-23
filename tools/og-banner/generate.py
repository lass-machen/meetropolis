#!/usr/bin/env python3
"""Build the Meetropolis social/banner image as a self-contained HTML page.

The page is 1200x630 (the standard OpenGraph size). A central 630x630 "safe
zone" carries the wordmark, claim and the core character group so a 1:1 crop
(WhatsApp and other square-thumbnail clients) still reads. All pixel art is
embedded as base64 data URIs at native resolution and upscaled in CSS with
`image-rendering: pixelated`, so the sprites stay crisp.

Copy is data (``--copy <json>``), so the same layout produces both the OSS
banner (English, ``copy.en.json`` here) and the commercial OG image (German,
``copy.de.json`` in the brand repo) without any marketing string living in this
file. All pixel assets are OSS: the six V4 default characters, the furniture,
the floor tile and the Press Start 2P font (SIL OFL) all ship in this repo.

Rendering to PNG is a second, browser-driven step (Press Start 2P + pixelated
compositing need a real layout engine); see ``README.md`` for the exact
command. The committed PNGs are the rendered artifacts.

Usage:
    python3 tools/og-banner/generate.py \
        --assets apps/web/public/assets \
        --font apps/web/public/fonts/PressStart2P.woff2 \
        --copy tools/og-banner/copy.en.json \
        --out /tmp/og.html
"""
import argparse
import base64
import io
import json
from PIL import Image


def b64_png(im: Image.Image) -> str:
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def trim(im: Image.Image) -> Image.Image:
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def sprite_frame(assets: str, key: str, direction: str) -> Image.Image:
    """One idle frame (column 0) from a 128x256 / 4x8 sheet, trimmed to content."""
    row = {"down": 0, "left": 1, "right": 2, "up": 3}[direction]
    sheet = Image.open(f"{assets}/sprites/{key}.png").convert("RGBA")
    return trim(sheet.crop((0, row * 32, 32, row * 32 + 32)))


def furn(assets: str, path: str) -> Image.Image:
    return trim(Image.open(f"{assets}/furniture/{path}").convert("RGBA"))


def build(assets: str, font_path: str, copy: dict) -> str:
    a = {}
    men = [
        ("business_man", "right"),
        ("casual_woman", "left"),
        ("dev_hoodie", "down"),
        ("manager_woman", "right"),
        ("suit_man", "left"),
        ("business_woman", "down"),
    ]
    for key, d in men:
        a[f"{key}_{d}"] = b64_png(sprite_frame(assets, key, d))
    a["desk"] = b64_png(furn(assets, "DESK/DESK_FRONT.png"))
    a["plant"] = b64_png(furn(assets, "PLANT/PLANT.png"))
    a["shelf"] = b64_png(furn(assets, "DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF.png"))
    a["large_plant"] = b64_png(furn(assets, "LARGE_PLANT/LARGE_PLANT.png"))
    a["whiteboard"] = b64_png(furn(assets, "WHITEBOARD/WHITEBOARD.png"))
    a["floor"] = b64_png(Image.open(f"{assets}/floors/floor_2.png").convert("RGBA"))
    with open(font_path, "rb") as f:
        font = "data:font/woff2;base64," + base64.b64encode(f.read()).decode()

    claim = f'{copy["claim_pre"]}<span class="accent">{copy["claim_accent"]}</span>{copy["claim_post"]}'
    return f"""<!doctype html>
<meta charset="utf-8">
<style>
@font-face {{ font-family:'Press Start 2P'; src:url('{font}') format('woff2'); font-display:block; }}
* {{ margin:0; padding:0; box-sizing:border-box; }}
html,body {{ width:1200px; height:630px; overflow:hidden; }}
.og {{ position:relative; width:1200px; height:630px;
  font-family:'Inter','Plus Jakarta Sans',system-ui,sans-serif;
  background:radial-gradient(120% 90% at 50% 8%, #6d28d9 0%, #4c0fb0 42%, #2a0a63 100%); overflow:hidden; }}
.glow {{ position:absolute; left:50%; top:214px; width:820px; height:360px; transform:translate(-50%,-50%);
  background:radial-gradient(closest-side, rgba(243,168,20,.28), rgba(243,168,20,0) 70%); filter:blur(2px); }}
.vig {{ position:absolute; inset:0;
  background:radial-gradient(130% 130% at 50% 40%, rgba(0,0,0,0) 55%, rgba(0,0,0,.35) 100%); }}
.floorband {{ position:absolute; left:0; right:0; bottom:0; height:250px;
  background-image:url('{a["floor"]}'); image-rendering:pixelated; background-size:50px 50px;
  -webkit-mask-image:linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,.55) 34%, rgba(0,0,0,.72) 100%);
          mask-image:linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,.55) 34%, rgba(0,0,0,.72) 100%);
  opacity:.5; }}
.scene {{ position:absolute; inset:0; }}
.px {{ position:absolute; image-rendering:pixelated; }}
.wordmark {{ position:absolute; left:0; right:0; top:156px; text-align:center;
  font-family:'Press Start 2P'; font-size:47px; letter-spacing:0; line-height:1; color:#fff;
  text-shadow:0 4px 0 #2a0a63, 0 0 34px rgba(243,168,20,.45); }}
.claim {{ position:absolute; left:0; right:0; top:246px; text-align:center;
  font-weight:800; font-size:44px; letter-spacing:-.5px; color:#fff; }}
.claim .accent {{ color:#ffcf5c; }}
.sub {{ position:absolute; left:50%; top:306px; transform:translateX(-50%); width:560px; text-align:center;
  font-weight:600; font-size:21px; color:#d9c9ff; opacity:.92; }}
.badge {{ position:absolute; left:50%; top:96px; transform:translateX(-50%); display:inline-flex; align-items:center;
  gap:10px; padding:9px 18px; border:1px solid rgba(255,255,255,.28); border-radius:999px;
  background:rgba(255,255,255,.06); color:#e8dcff; font-weight:600; font-size:16px; }}
.badge .dot {{ width:9px; height:9px; border-radius:50%; background:#f3a814; box-shadow:0 0 10px #f3a814; }}
</style>
<div class="og">
  <div class="glow"></div><div class="floorband"></div><div class="vig"></div>
  <div class="scene">
    <img class="px" src="{a['shelf']}"      style="left:120px;  bottom:196px; width:132px;">
    <img class="px" src="{a['whiteboard']}"  style="left:951px;  bottom:198px; width:150px;">
    <img class="px" src="{a['large_plant']}" style="left:1070px; bottom:150px; width:96px;">
    <img class="px" src="{a['plant']}"       style="left:60px;   bottom:150px; width:60px;">
    <img class="px" src="{a['desk']}"        style="left:250px;  bottom:120px; width:150px;">
    <img class="px" src="{a['desk']}"        style="left:815px;  bottom:120px; width:150px;">
    <img class="px" src="{a['dev_hoodie_down']}"     style="left:556px; bottom:120px; height:150px;">
    <img class="px" src="{a['business_man_right']}"  style="left:470px; bottom:96px;  height:150px;">
    <img class="px" src="{a['casual_woman_left']}"   style="left:648px; bottom:100px; height:150px;">
    <img class="px" src="{a['manager_woman_right']}" style="left:262px; bottom:92px;  height:140px;">
    <img class="px" src="{a['suit_man_left']}"       style="left:902px; bottom:92px;  height:140px;">
    <img class="px" src="{a['business_woman_down']}" style="left:150px; bottom:96px;  height:132px;">
  </div>
  <div class="badge"><span class="dot"></span>{copy['badge']}</div>
  <div class="wordmark">{copy['wordmark']}</div>
  <div class="claim">{claim}</div>
  <div class="sub">{copy['sub']}</div>
</div>
"""


def main() -> None:
    p = argparse.ArgumentParser(description="Build the Meetropolis OG/banner HTML.")
    p.add_argument("--assets", required=True, help="OSS asset dir (apps/web/public/assets)")
    p.add_argument("--font", required=True, help="Press Start 2P woff2 path")
    p.add_argument("--copy", required=True, help="copy JSON (badge/wordmark/claim_*/sub)")
    p.add_argument("--out", required=True, help="output HTML path")
    args = p.parse_args()
    with open(args.copy, encoding="utf-8") as f:
        copy = json.load(f)
    html = build(args.assets, args.font, copy)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
