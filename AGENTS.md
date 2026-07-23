# AGENTS.md — Meetropolis

Meetropolis is an open-source virtual office platform for remote teams.
It provides proximity-based spatial audio and video, a live 2D world built
on Phaser, and a real-time multi-user engine powered by Colyseus.
The server is licensed under AGPL-3.0; the web client and shared package
under MIT. See [LICENSING.md](LICENSING.md) for the full breakdown.

This file is tool-neutral. It applies to every contributor — human or
agent. Tool-specific overrides (`.claude/CLAUDE.md`, `.cursorrules`, etc.)
layer on top of these rules; they never replace them.

---

## Repository layout

```
meetropolis/
├── apps/
│   ├── server/          # Express + Colyseus + Prisma  (AGPL-3.0)
│   │   └── prisma/      # schema + migrations
│   ├── web/             # React + Vite + Phaser + i18next  (MIT)
│   ├── npc-service/     # NPC automation service
│   └── loadtest/        # Load-testing harness
├── packages/
│   └── shared/          # Shared types and utilities  (MIT)
├── scripts/
│   ├── enforce-budgets.js   # LoC budget gate (runs in npm run lint)
│   └── lint-stats.cjs       # ESLint warning regression gate
├── AGENTS.md                # This file
├── CONTRIBUTING.md          # Contribution process, DCO, licensing grant
├── LIBRARY_BOUNDARIES.md    # Handling unsafe library edges in strict TS
├── TEST_STRATEGY.md         # Testing philosophy and coverage expectations
├── eslint.config.mjs        # ESLint flat config
├── commitlint.config.mjs    # Conventional commits enforcement
├── tsconfig.base.json       # TypeScript base config (strict)
├── lint-stats.json          # Committed lint-warning baseline
└── .budgetignore            # Documented exceptions to LoC budgets
```

The server and web app expose a small number of dynamic-import boundaries
that resolve to `null` in this distribution. See
[Closed-source module boundaries](#closed-source-module-boundaries) below.

---

## Essential commands

Run from the repository root unless noted.

```bash
# Install
npm install

# Development
npm run dev            # server + web concurrently (hot reload)
npm run dev:server     # server only
npm run dev:web        # web only

# Build
npm run build          # Vite (web) + tsc (server)
npm run typecheck      # tsc --noEmit across all workspaces

# Lint pipeline (ESLint + budget gate + lint-stats regression)
npm run lint
npm run lint:fix       # auto-fix where possible

# Format
npm run format         # Prettier write
npm run format:check   # Prettier check (no write)

# Tests
npm -w @meetropolis/web run test
npm -w @meetropolis/server run test

# Database (Prisma)
npm run generate
npm run prisma:migrate

# Self-host stack
docker compose up --build
```

Before opening a pull request, at minimum run `npm run lint`,
`npm run typecheck`, and the relevant workspace test suite.

---

## Code quality conventions

### TypeScript

- `tsconfig.base.json` enables `strict` mode across all workspaces.
- No `any`, no `as unknown as` casts. Prefer generic types.
- When a type-unsafe edge is genuinely unavoidable (third-party library,
  runtime global, optional submodule boundary), follow the four-tier
  approach documented in [LIBRARY_BOUNDARIES.md](LIBRARY_BOUNDARIES.md)
  before reaching for an inline `eslint-disable`.

### Style

- Single quotes, semicolons, 2-space indentation (Prettier-enforced).
- Components: `PascalCase.tsx`. Hooks and utilities: `camelCase.ts`.
- Phaser scene classes: `*Scene.ts`.

### Architecture layers

- `packages/shared` contains shared types and utilities only. No imports
  from `apps/*` into `packages/*`.
- Global UI state lives in Zustand stores under `apps/web/src/state/`.
  Component-local state stays in components or hooks.
- React (UI), Phaser (game) and Colyseus/LiveKit (realtime) are decoupled
  via a narrow bridge (`apps/web/src/game/bridge.ts`). Do not import React
  from Phaser scene files or vice versa.
- Server routes and handlers live under `apps/server/src/`. Colyseus room
  logic lives under `apps/server/src/rooms/`.

### Design principles

- Clarity over cleverness. Readable, testable code over one-liners.
- Small units. Single responsibility per function and module.
- Guard clauses over pyramid-of-doom nesting (max 3 levels deep).
- Re-use first. Check for existing components, hooks, or utilities before
  building new ones.
- No swallowed errors. Every caught exception is either handled or
  re-thrown with context.

---

## LoC budgets

Hard limits are enforced by `scripts/enforce-budgets.js` as part of
`npm run lint`. Exceeding the hard limit blocks the lint step.

| File type                            | Target       | Hard limit |
| ------------------------------------ | ------------ | ---------- |
| React / TS / server files            | 400 LoC      | 600 LoC    |
| Phaser scene files                   | 300 LoC      | 800 LoC    |
| Utility modules                      | 300 LoC      | 450 LoC    |
| Functions / components               | 50 LoC       | 80 LoC     |
| Composite hooks (`use*Composite.ts`) | 120 LoC body | —          |

Files that legitimately exceed a hard limit are listed in `.budgetignore`
with a written rationale. If you are adding code to a file that already
has a `.budgetignore` entry, do not grow it further without discussion.
If a file you are editing reaches the hard limit, split it before merging.

---

## Linting and type checking

```bash
npm run lint           # full pipeline: ESLint + budget gate + lint-stats
npm run lint:fix       # ESLint with auto-fix
npm run typecheck      # tsc --noEmit across all workspaces
```

`lint-stats.json` records the committed warning-count baseline. If your
change increases the warning count, the `lint:stats` step fails. To
intentionally accept a new warning, update the baseline first:

```bash
npm run lint:stats:update
# then commit lint-stats.json alongside your change
```

Do not suppress ESLint rules inline without a written justification on the
same line. See [LIBRARY_BOUNDARIES.md](LIBRARY_BOUNDARIES.md) for the
approved suppression patterns.

---

## Testing

See [TEST_STRATEGY.md](TEST_STRATEGY.md) for the full testing philosophy
and coverage expectations. Short version:

- **Unit tests** (`*.test.ts`, `*.test.tsx`) live next to the module they
  test. New logic requires at least a baseline unit test. Regression bugs
  require a test before the fix.
- **Integration tests** (`*.integration.test.ts`) cover API + DB + Colyseus
  together in the server workspace.
- **E2E tests** (Playwright) live under `apps/web/e2e/`.

Test runner: Vitest for unit and integration; Playwright for E2E.

```bash
npm -w @meetropolis/web run test
npm -w @meetropolis/server run test
```

---

## Commit conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
`commitlint` enforces this via a Husky `commit-msg` hook.

```
<type>(<scope>): <subject>

[optional body]
[optional footer]
```

- Subject: **lower-case**, imperative mood, no trailing period.
- Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `chore`, `test`, `ci`,
  `build`, `style`.
- Scope: workspace or area affected (`server`, `web`, `shared`, `build`,
  `email`, `prisma`, etc.).
- One concern per commit.
- Do not use `--no-verify` to bypass the hook.

Examples:

```
feat(web): add zone capacity badges to room list
fix(server): handle missing livekit token on reconnect
chore(build): pin node to 24.x in ci workflow
refactor(shared): extract position types into geometry module
```

Every commit on a pull request must carry a DCO sign-off:

```bash
git commit --signoff -m "feat(web): add zone capacity badges"
```

This appends `Signed-off-by: Your Name <your@email.com>` to the commit
message. See [CONTRIBUTING.md](CONTRIBUTING.md) for details on the DCO
and the inbound license grant.

---

## Pull request workflow

1. Branch from `main`. Naming: `feature/<slug>`, `fix/<slug>`, `chore/<slug>`.
2. Keep the PR focused on a single concern.
3. Fill in all sections of the
   [PR template](.github/PULL_REQUEST_TEMPLATE.md): summary, type of
   change, affected components, test plan, licensing checklist.
4. For UI or game changes, attach screenshots or a short screen recording.
5. For env-var changes, document the new or modified variable in
   `.env.example` and in the PR description.
6. For new runtime dependencies, state the license and confirm it is
   compatible with both AGPL-3.0 and MIT. GPL-only or AGPL-only deps need
   maintainer agreement first.
7. Run build, lint, typecheck and the relevant tests locally before
   requesting review (CI is defined in `.github/workflows/ci.yml` but runs
   only manually via workflow_dispatch while the org's GitHub Actions
   billing is blocked, so verify locally).
8. At least one maintainer review is required before merge.

Report bugs and request features via GitHub Issues. Use the templates
under [.github/ISSUE_TEMPLATE/](.github/ISSUE_TEMPLATE/).

---

## Closed-source module boundaries

The OSS build exposes dynamic-import boundaries that resolve to `null`
when the optional closed-source modules (Brand, Enterprise, Desktop) are
absent. The app degrades gracefully.

Server-side loaders:

- `apps/server/src/tenancyLoader.ts`
- `apps/server/src/billingLoader.ts`
- `apps/server/src/adminLoader.ts`
- `apps/server/src/emailLoader.ts`

Web-side loaders:

- `apps/web/src/lib/enterpriseWebLoader.ts`
- `apps/web/src/lib/brandLoader.ts`
- `apps/web/src/lib/desktopLoader.ts`
- `apps/web/optional-submodules.ts`

**Never bypass these loaders.** Do not add direct imports that assume a
closed-source module is present. All feature checks must go through the
loader return value (null-check pattern). This ensures the OSS build
continues to work without the optional modules.

Do not add `@tauri-apps` imports anywhere in `apps/web/`. Tauri-specific
code belongs exclusively in the Desktop module, which is not part of
this distribution.

---

## Security

- Never commit secrets, credentials, or private keys.
- Use `.env.example` as the template. Variables that hold secrets must
  appear there with a placeholder and a comment.
- `JWT_SECRET` and `API_TOKEN_PEPPER` are required at runtime and must be
  cryptographically random (32+ characters) in production.
- Do not set `SMTP_TLS_REJECT_UNAUTHORIZED=false` in production.
- See [SECURITY.md](SECURITY.md) for the responsible disclosure policy.

---

## Agent-specific guidance

- Make small, focused edits. Do not reformat files that are not part of
  your task.
- Respect existing indentation and formatting. Apply only the minimum
  change needed.
- Before editing, do a brief survey of the affected module. After
  editing, confirm that `npm run lint` and `npm run typecheck` still pass.
- Do not add new runtime dependencies without stating the reason and the
  license in the PR description.
- Do not grow files that already have `.budgetignore` entries. If a file
  you are editing reaches the hard LoC limit, split it first.
- Do not bypass Husky hooks (`--no-verify`). Fix the underlying issue.
