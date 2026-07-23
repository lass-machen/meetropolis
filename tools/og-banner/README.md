# OG / social banner generator

Builds the Meetropolis social image (1200×630) from OSS pixel assets — the six
V4 default characters, the office furniture, the floor tile and the Press
Start 2P wordmark. The layout keeps the wordmark, claim and the core character
group inside a central 630×630 safe zone, so a 1:1 crop (WhatsApp and other
square-thumbnail clients) shows the message without clipping.

Copy is data, so the same layout renders any language. This repo ships the
English OSS copy (`copy.en.json`), used for the README banner
(`docs/assets/banner.png`). The commercial German OG image lives in the brand
repo, which supplies its own `copy.de.json` and points this tool at the OSS
assets (see `meetropolis-brand/brand-assets/og/README.md`).

## Regenerate

Two steps: build the self-contained HTML, then screenshot it at 1200×630.

```bash
# 1) build the HTML (needs Pillow: pip install pillow)
python3 tools/og-banner/generate.py \
  --assets apps/web/public/assets \
  --font apps/web/public/fonts/PressStart2P.woff2 \
  --copy tools/og-banner/copy.en.json \
  --out /tmp/og.html

# 2) render to PNG at exactly 1200x630 with any headless browser.
#    Rendering is browser-driven because Press Start 2P (woff2) and the
#    pixelated compositing need a real layout engine. Example with Playwright:
npx playwright screenshot --viewport-size=1200,630 \
  "file:///tmp/og.html" docs/assets/banner.png
```

The committed `docs/assets/banner.png` is the rendered artifact. Edit
`copy.en.json` (or the sprite/furniture positions in `generate.py`) and re-run
to change it.
