# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0]

### Initial open-source release of Meetropolis

Meetropolis is an open-source virtual office platform for remote teams.
It combines proximity-based spatial audio and video with a live 2D world
built on Phaser and a real-time multi-user engine powered by Colyseus.

#### Added

- Self-hostable server (Express + Colyseus + Prisma) under AGPL-3.0-only
- Browser client (React + Vite + Phaser) under MIT
- Shared types and utilities package (`@meetropolis/shared`) under MIT
- Procedural character sprite generator (`tools/sprite-generator/`) and
  six built-in office characters
- Default office map built from MIT-licensed
  [pixel-agents](https://github.com/pablodelucca/pixel-agents) tiles
  via `tools/map-builder/`
- LiveKit-based spatial audio with zone-aware proximity falloff
- Single-tenant deployment via `docker compose`
- Optional dynamic-import boundaries (`*Loader.ts`) for closed-source
  enterprise modules; OSS build resolves them to `null` and degrades
  gracefully

#### Edition boundary

The OSS edition is capped at **25 concurrent users** across the entire
server. The cap is enforced in code (`packages/shared/src/tenancy.ts`,
`apps/server/src/rooms/lifecycle/onJoin.limiter.ts`) and is intentionally
not configurable via environment variable. Raising the cap requires the
commercial edition; see [`LICENSING.md`](LICENSING.md).

#### Licensing

- Server, NPC service, load-test harness, repository root:
  **AGPL-3.0-only**
- Browser client (`apps/web`) and shared package (`packages/shared`):
  **MIT**
- A commercial license is available from Tiamat UG for organisations
  that cannot meet the AGPL-3.0 source-availability obligations. See
  [`LICENSING.md`](LICENSING.md).
- Contributor inbound license: contributions are accepted under the same
  license as the file they touch, plus a grant to Tiamat UG to relicense
  contributions commercially. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

[Unreleased]: https://github.com/lass-machen/meetropolis/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lass-machen/meetropolis/releases/tag/v0.1.0
