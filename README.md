# Meetropolis

An open-source virtual office platform for remote teams. Proximity-based
spatial audio/video, a live 2D world built on Phaser, and a real-time
multi-user engine powered by Colyseus.

![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)
![Node](https://img.shields.io/badge/Node-24-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue.svg)

## Quick Start

```bash
git clone https://github.com/lass-machen/meetropolis.git
cd meetropolis
cp .env.example .env          # edit with your values
docker compose up --build     # starts db, server, web, livekit
```

After startup:

| Service                  | URL                   |
| ------------------------ | --------------------- |
| Web app                  | http://localhost:5173 |
| Server (Colyseus + REST) | http://localhost:2567 |
| LiveKit                  | http://localhost:7880 |

### Local development without Docker

Requires a running PostgreSQL instance. Configure `DATABASE_URL` in `.env`.

```bash
npm install
npm run dev          # starts server + web concurrently
```

The server's `predev` script runs Prisma schema compose, generate, db push
and seed automatically before the dev server boots.

To run workspaces individually:

```bash
npm run dev:server   # apps/server only
npm run dev:web      # apps/web only
```

## Requirements

| Requirement             | Version                                                  |
| ----------------------- | -------------------------------------------------------- |
| Node.js                 | `>=24.0.0 <25` (enforced by `engines` in `package.json`) |
| npm                     | `11.7.0` (pinned via `packageManager`)                   |
| Docker + Docker Compose | optional, for the full-stack local setup                 |
| PostgreSQL 16           | required for local dev without Docker                    |

> **macOS / Windows + Docker Desktop note:** Chrome filters loopback ICE
> candidates. Set `LK_NODE_IP` in `.env` to your machine's LAN IP (not
> `127.0.0.1`) and restart LiveKit: `docker compose restart livekit`.

## Repo structure

```
meetropolis/
├── apps/
│   ├── server/              # Express + Colyseus + Prisma
│   │   └── prisma/          # schema (composed) + migrations
│   ├── web/                 # React + Vite + Phaser + i18next
│   │   └── src/locales/     # i18n catalog (en, de)
│   ├── npc-service/         # NPC automation service
│   ├── loadtest/            # Load-testing harness
│   └── debug-client/        # macOS debug client (Swift/Xcode)
├── packages/
│   ├── shared/              # Shared types and utilities (OSS)
│   ├── desktop/             # Tauri desktop app (private submodule, optional)
│   ├── brand/               # Meetropolis branding + legal pages (private submodule)
│   └── tenancy-enterprise/  # Multi-tenancy + billing (private submodule)
├── scripts/
│   ├── enforce-budgets.js   # LoC budget gate (runs via npm run lint)
│   └── lint-stats.cjs       # ESLint warning regression gate
├── docs/                    # Extended docs (enterprise.md, brand.md, ...)
├── AGENTS.md                # Dev guidelines and quality budgets
├── LIBRARY_BOUNDARIES.md    # Type-boundary patterns for unsafe library edges
├── TEST_STRATEGY.md         # Testing approach and coverage expectations
├── lint-stats.json          # Tracked lint warning baseline (committed)
├── eslint.config.mjs        # ESLint flat config
├── commitlint.config.mjs    # Conventional commits enforcement
├── docker-compose.yml          # Default dev stack
├── docker-compose.override.yml # Local overrides (auto-applied)
├── docker-compose.prod.yml     # Production deployment
└── .env.example             # All available environment variables
```

Private submodules (`desktop`, `brand`, `tenancy-enterprise`) are optional.
The OSS edition runs fully without them. They are loaded at runtime via
dynamic imports; absent modules return `null` gracefully.

## Development

### Root scripts (run from repo root)

| Script                      | What it does                                       |
| --------------------------- | -------------------------------------------------- |
| `npm run dev`               | Start server + web concurrently                    |
| `npm run dev:server`        | Server only                                        |
| `npm run dev:web`           | Web only                                           |
| `npm run build`             | Build web (Vite) and server (tsc)                  |
| `npm run typecheck`         | `tsc --noEmit` in all workspaces                   |
| `npm run lint`              | ESLint + budget gate + lint-stats regression check |
| `npm run lint:fix`          | ESLint with auto-fix                               |
| `npm run lint:stats:update` | Update the committed lint warning baseline         |
| `npm run format`            | Prettier write                                     |
| `npm run format:check`      | Prettier check (used in CI)                        |
| `npm run generate`          | Compose Prisma schema and run `prisma generate`    |
| `npm run prisma:migrate`    | Create and apply a new migration                   |

### Desktop app

The Tauri desktop app lives in `packages/desktop` (private submodule). It is
not part of the OSS build. Without the submodule, all desktop-dependent code
paths degrade gracefully via `apps/web/src/lib/desktopLoader.ts`.

### Environment variables

Copy `.env.example` to `.env`. Key variables:

| Variable             | Description                                             |
| -------------------- | ------------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string                            |
| `JWT_SECRET`         | JWT signing secret (32+ chars in production)            |
| `LIVEKIT_URL`        | LiveKit server URL                                      |
| `LIVEKIT_API_KEY`    | LiveKit API key                                         |
| `LIVEKIT_API_SECRET` | LiveKit API secret                                      |
| `LK_NODE_IP`         | Host LAN IP for LiveKit ICE (Docker Desktop on macOS)   |
| `CORS_ORIGIN`        | Allowed CORS origins (required in production)           |
| `OSS_USER_LIMIT`     | Concurrent user limit for the OSS edition (default: 25) |

See `.env.example` for the full list including optional variables.

## Testing

Tests use [Vitest](https://vitest.dev/).

```bash
# Web (apps/web)
npm --workspace=@meetropolis/web run test

# Server (apps/server)
npm --workspace=@meetropolis/server run test
```

See [TEST_STRATEGY.md](TEST_STRATEGY.md) for the project's testing
philosophy, coverage expectations, and guidance on where to place new tests.

## Linting and code style

### ESLint + Prettier

```bash
npm run lint           # full lint pipeline
npm run lint:fix       # auto-fix where possible
npm run format         # Prettier write
npm run format:check   # Prettier check
```

### Lint regression gate

`lint-stats.json` records the current warning count baseline. The
`lint:stats` script fails if the warning count exceeds the baseline. Before
accepting an intentional suppression or a temporary warning increase, update
the baseline:

```bash
npm run lint:stats:update
```

Commit the updated `lint-stats.json` alongside your change.

### LoC budget enforcement

`scripts/enforce-budgets.js` enforces file-size limits defined in
[AGENTS.md](AGENTS.md):

- React/TS/server files: target <= 400 LoC, hard limit 600 LoC
- Phaser scene files: target <= 300 LoC, hard limit 450 LoC (with documented exceptions)
- Utility modules: target <= 300 LoC, hard limit 450 LoC

Files exceeding the hard limit block the lint step. Refactor before merging.
Files that are intentional exceptions (Phaser scene classes, composite
hooks) are listed in `.budgetignore` with a written reason.

### Type-boundary patterns

Third-party libraries, runtime globals and optional submodule boundaries
require special handling to stay compatible with strict TypeScript and the
`@typescript-eslint/no-unsafe-*` rules. The project's four-tier approach
(wrapper types, module augmentation, file-scoped overrides, inline disables
with written justification) is documented in
[LIBRARY_BOUNDARIES.md](LIBRARY_BOUNDARIES.md). Read it before adding any
`as any` or ESLint disable.

### Commit style

Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
`commitlint` enforces this via a Husky `commit-msg` hook. A `pre-commit`
hook runs `lint-staged`.

## Editions and architecture

The codebase is split across three repositories combined at build time via
Git submodules:

| Edition     | Submodule                               | License    | What it adds                                                       |
| ----------- | --------------------------------------- | ---------- | ------------------------------------------------------------------ |
| Open Source | this repo                               | Apache 2.0 | Single-tenant virtual office, spatial AV, map editor, i18n (en/de) |
| Enterprise  | `packages/tenancy-enterprise` (private) | Commercial | Multi-tenancy, Stripe billing, admin UI, billing audit log         |
| Brand       | `packages/brand` (private)              | Commercial | Meetropolis marketing site, legal pages, analytics, brand assets   |

Server loaders: `apps/server/src/{tenancyLoader,billingLoader,adminLoader}.ts`
Web loaders: `apps/web/src/lib/{enterpriseWebLoader,brandLoader,desktopLoader}.ts`

Without private submodules the OSS edition runs single-tenant and shows a
generic unbranded landing page.

**OSS user limit:** 25 concurrent users by default. Configurable via the
`OSS_USER_LIMIT` environment variable.

## Self-hosting a branded instance

Before deploying for your team or customers:

1. Replace brand assets in `apps/web/public/brand/` (logo, favicon).
2. Provide your own legal pages (`/privacy`, `/terms`, `/impressum`). Without
   the brand submodule, these routes show a placeholder.
3. Update the HTML title and meta description in `apps/web/index.html`.
4. Configure your own analytics tracking (`VITE_META_PIXEL_ID`) or leave it
   disabled.
5. Review and adjust source strings that reference "Meetropolis" if you
   intend to publish a derivative product (see [TRADEMARKS.md](TRADEMARKS.md)).

## API tokens

Control your presence remotely via personal API tokens:

1. Open "API Tokens and Docs" from the top-right menu.
2. Create a token. It is shown only once, save it.
3. Use it to control mic, camera, screenshare and DND status:

```bash
curl -X POST "http://localhost:2567/controls" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mic": false, "dnd": true}'
```

## Production deployment

```bash
cp .env.example .env   # configure production values
docker compose -f docker-compose.prod.yml up -d
```

Minimum production configuration:

| Variable           | Requirement                              |
| ------------------ | ---------------------------------------- |
| `NODE_ENV`         | `production`                             |
| `JWT_SECRET`       | Cryptographically random, 32+ characters |
| `API_TOKEN_PEPPER` | Random string for API token hashing      |
| `CORS_ORIGIN`      | Explicit list of allowed origins         |
| `COOKIE_SECURE`    | `true`                                   |

## Contributing

Read [AGENTS.md](AGENTS.md) before opening a PR. It covers architecture
rules, quality budgets, naming conventions, commit workflow and PR
expectations. Most of these are enforced by tooling (Husky, commitlint,
ESLint, budget scripts).

Also read:

- [CONTRIBUTING.md](CONTRIBUTING.md) - general contribution process
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md) - responsible disclosure and known advisories

## License

The OSS edition is released under the [Apache 2.0 License](LICENSE). See
[NOTICE](NOTICE) for third-party attributions.

Enterprise and Brand editions are available under a commercial license.
Contact [info@meetropolis.de](mailto:info@meetropolis.de) for details.

The "Meetropolis" name and logo are trademarks. Apache 2.0 does not grant
rights to use them. See [TRADEMARKS.md](TRADEMARKS.md).
