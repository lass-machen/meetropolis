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

> **Placeholder section.** A custom sprite pack is being commissioned to
> replace the current placeholders. The full artist briefing lives in the
> [`meetropolis-deploy`](https://github.com/tiamatlabs/meetropolis-deploy)
> private repository under `knowledge/character-sprites-spec.md`. Once the
> artwork lands in `apps/web/public/assets/`, this section will be filled
> in with the artist's name, license, and source commit.

### Character sprites

| Asset path                        | Artist      | License     | Source / commit |
| --------------------------------- | ----------- | ----------- | --------------- |
| `apps/web/public/assets/sprites/` | _(pending)_ | _(pending)_ | _(pending)_     |

### Furniture, floors, walls

| Asset path                          | Source project                                      | License | Snapshot commit                             |
| ----------------------------------- | --------------------------------------------------- | ------- | ------------------------------------------- |
| `apps/web/public/assets/furniture/` | _(to be migrated from `pablodelucca/pixel-agents`)_ | MIT     | _(commit to be recorded at migration time)_ |
| `apps/web/public/assets/floors/`    | _(same as above)_                                   | MIT     | _(same)_                                    |
| `apps/web/public/assets/walls/`     | _(same as above)_                                   | MIT     | _(same)_                                    |

### Tilesets

| Asset path                 | Source                     | License                    | Notes                      |
| -------------------------- | -------------------------- | -------------------------- | -------------------------- |
| _(filled in at migration)_ | _(filled in at migration)_ | _(filled in at migration)_ | _(filled in at migration)_ |

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
