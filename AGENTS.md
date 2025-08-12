# Repository Guidelines

## Project Structure & Module Organization
- Monorepo using npm workspaces: `apps/*`, `packages/*`.
- `apps/server`: Express + Colyseus game server, Prisma schema in `apps/server/prisma/`, source in `apps/server/src/`.
- `apps/web`: React + Vite + Phaser client, source in `apps/web/src/`, static assets in `apps/web/public/` (e.g., `assets/`, `maps/`).
- `packages/shared`: Reusable TypeScript types/utilities in `packages/shared/src/`.

## Build, Test, and Development Commands
- Install: `npm install` (at repo root; installs all workspaces).
- Dev (both): `npm run dev` (runs server and web concurrently).
- Dev (web): `npm run dev:web` or `npm -w @meetropolis/web run dev`.
- Dev (server): `npm run dev:server` or `npm -w @meetropolis/server run dev`.
- Build: `npm run build` (web then server). Web preview: `npm -w @meetropolis/web run preview`.
- Prisma: `npm run generate` (client), `npm run prisma:migrate` (create/apply migrations).
- Docker (db, server, web, livekit): `docker compose up --build`.

## Coding Style & Naming Conventions
- Language: TypeScript (strict mode enabled via `tsconfig.base.json`).
- Indentation: 2 spaces; semicolons; single quotes for strings.
- React components: `PascalCase.tsx` (e.g., `App.tsx`). Utilities/hooks: `camelCase.ts`.
- Phaser scenes: `PascalCase` with `Scene` suffix (e.g., `BootScene.ts`).
- Colyseus schema uses decorators; keep `experimentalDecorators` enabled.

## Testing Guidelines
- No formal test suite yet. For new code, prefer lightweight unit tests colocated under `__tests__` with `*.test.ts` and deterministic helpers.
- Manual flows: verify server at `http://localhost:2567`, web at `http://localhost:5173`, and basic multiplayer join/move.

## Commit & Pull Request Guidelines
- Commits: concise, imperative summaries (present tense). Group related changes; avoid mixed concerns.
- Branches: `feature/<slug>`, `fix/<slug>`, `chore/<slug>`.
- PRs: clear description, linked issues, setup steps, test plan; include screenshots or short clips for UI/gameplay changes; note env vars touched.

## Security & Configuration Tips
- Never commit secrets. Copy `.env.example` to `.env` and set `DATABASE_URL`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `VITE_*`.
- Local DB runs via Docker Postgres; Prisma models live in `apps/server/prisma/schema.prisma`.
