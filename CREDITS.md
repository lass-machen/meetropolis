# Credits

Meetropolis is built on top of a stack of open-source software, art, and
ideas. This file calls out the people and projects whose work shows up
directly in the released codebase. License texts for every dependency are
in [`THIRD_PARTY_LICENSES/`](THIRD_PARTY_LICENSES/). Trademark policy is in
[`TRADEMARKS.md`](TRADEMARKS.md). Software dependencies and their
attributions are in [`NOTICE`](NOTICE).

This file specifically handles the **non-code creative work** (sprite art,
sound effects, tilesets, fonts) that ships in the repository.

## Visual assets

### Character sprites

The six built-in office characters are generated procedurally from
hand-authored pixel-grid templates (a small rendering engine plus data
catalogs). No third-party pixel data is read, sampled, or referenced. The
generator code and its catalogs live in
[`tools/sprite-generator/`](tools/sprite-generator/) so the output is
reproducible and the community can extend the cast without external
dependencies.

| Asset path                                  | Artist    | License | Source                    |
| ------------------------------------------- | --------- | ------- | ------------------------- |
| `apps/web/public/assets/sprites/*.png` (6×) | Tiamat UG | MIT     | `tools/sprite-generator/` |

The generator code in [`tools/sprite-generator/`](tools/sprite-generator/) is
AGPL-3.0-only; its generated output — these six sprites and
`packages/shared/sprite/catalog.json` — is MIT-licensed by Tiamat UG,
consistent with the `apps/web` and `@meetropolis/shared` packages it ships in.
The AGPL-3.0 copyleft applies to third parties who run the generator themselves.

### Furniture, floors, walls

| Asset path                          | Source project                                                            | License | Snapshot commit                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `apps/web/public/assets/furniture/` | [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents) | MIT     | [`ef9fe9e`](https://github.com/pablodelucca/pixel-agents/commit/ef9fe9ed5b6c01a8f4503a2b66939960c059a104) |
| `apps/web/public/assets/floors/`    | [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents) | MIT     | [`ef9fe9e`](https://github.com/pablodelucca/pixel-agents/commit/ef9fe9ed5b6c01a8f4503a2b66939960c059a104) |
| `apps/web/public/assets/walls/`     | [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents) | MIT     | [`ef9fe9e`](https://github.com/pablodelucca/pixel-agents/commit/ef9fe9ed5b6c01a8f4503a2b66939960c059a104) |

We snapshot the upstream files into our repository so that builds are
reproducible without a network round trip. The full MIT license text from
the upstream project ships in
[`THIRD_PARTY_LICENSES/MIT-pixel-agents.txt`](THIRD_PARTY_LICENSES/MIT-pixel-agents.txt).

### Derived tilesheets and the default office map

The three stitched tilesheets in
[`apps/web/public/assets/tilesets/`](apps/web/public/assets/tilesets/)
and the default office map JSON are **generated** by
[`tools/map-builder/build_office_map.py`](tools/map-builder/) from the
pixel-agents inputs above. They inherit the MIT license of the sources.
The build script itself is AGPL-3.0-only. `collision.png` is Tiamat's own generated output (not a pixel-agents derivative); like the sprite catalog it is MIT-licensed by Tiamat UG, while the build script stays AGPL-3.0-only.

| Asset path                                         | Built from                                       | License | Notes                                                                            |
| -------------------------------------------------- | ------------------------------------------------ | ------- | -------------------------------------------------------------------------------- |
| `apps/web/public/assets/tilesets/office_floor.png` | `apps/web/public/assets/floors/floor_{0..8}.png` | MIT     | 9 cols x 9 rows; each row is a colorized floor variant (HSL colorize)            |
| `apps/web/public/assets/tilesets/office_wall.png`  | `apps/web/public/assets/walls/wall_0.png`        | MIT     | 4 cols x 4 rows of 16x32 autotile pieces (bit 0 = N, 1 = E, 2 = S, 3 = W)        |
| `apps/web/public/assets/tilesets/collision.png`    | generated                                        | MIT     | 16x16 translucent red marker emitted by the build script                         |
| `apps/web/public/maps/office.json`                 | pixel-agents floors / walls / furniture          | MIT     | 50 x 40 grid with six visually distinct zones and ~110 furniture / decor objects |

## Icons

| Path                                 | Source                | License |
| ------------------------------------ | --------------------- | ------- |
| Lucide icon set (via `lucide-react`) | <https://lucide.dev/> | ISC     |

## Fonts

| Family                                                | Source | License |
| ----------------------------------------------------- | ------ | ------- |
| _(none bundled in the repo today; system fonts only)_ | —      | —       |

If a font ends up bundled later (for example to guarantee a consistent
look across browsers), it must be SIL OFL or a similarly permissive
license and listed here with a download source and version.

## Sound effects

| Asset path                                                                                                   | Source | License |
| ------------------------------------------------------------------------------------------------------------ | ------ | ------- |
| _(none bundled today; the NPC subsystem plays admin-uploaded media, which is the operator's responsibility)_ | —      | —       |

## Code-level acknowledgements

The Meetropolis codebase draws stylistic and architectural ideas from
several other open-source projects. These projects are not bundled, but
they shaped the design. Listed alphabetically.

- **[Colyseus](https://colyseus.io/)** — Real-time game-room framework we
  use directly for multiplayer state sync.
- **[Gather.town](https://www.gather.town/)** — The product category that
  inspired Meetropolis (we are not affiliated and our codebase is not
  derived from theirs).
- **[LiveKit](https://livekit.io/)** — WebRTC SFU + SDK that powers our
  spatial audio.
- **[Phaser](https://phaser.io/)** — The 2D rendering engine.
- **[Plausible Analytics](https://plausible.io/)** — Their AGPL + MIT
  dual-license model is the direct template for ours; see
  [`LICENSING.md`](LICENSING.md).
- **[Prisma](https://www.prisma.io/)** — Database access layer.

If you contributed work that should appear here and is missing, please
open a pull request. We treat omissions as bugs.

## How to update this file

1. Whenever you add a new asset to the repository, add a row to the
   appropriate section above with: path, artist/source, license, and the
   upstream commit-sha or tag you snapshotted from.
2. Whenever you remove an asset, remove the corresponding row.
3. Whenever in doubt about whether an asset is properly licensed for
   redistribution under AGPL-3.0 and/or MIT, **do not commit it**. Ask in
   the PR first.
