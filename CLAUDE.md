# Claude Code Instructions

**IMPORTANT: Always read `/AGENTS.md` first before making any changes to this codebase.**

## Quick Reference

### Monorepo Structure
- `apps/server`: Express + Colyseus + Prisma
- `apps/web`: React + Vite + Phaser
- `packages/shared`: Shared types and utilities
- `packages/desktop`: (Private Submodule) Tauri Desktop App — optional, OSS funktioniert ohne

### Key Files for Context
- `/AGENTS.md` - Development guidelines, quality budgets, architecture rules
- `/README.md` - Project overview and setup
- `/docker-compose.prod.yml` - Production deployment config

### Desktop App (Private Submodule)
Desktop-Features (Tauri) sind in `packages/desktop/` ausgelagert (privates Git-Submodule).
Die Web-App lädt Desktop-Features per `desktopLoader.ts` via Dynamic Import.
Ohne Submodule funktioniert alles — der Loader gibt graceful `null` zurück.

### Common Gotchas
1. **API Base URL**: Desktop-Clients setzen `window.__MEETROPOLIS_API_BASE__` — der Code nutzt dieses Flag für Desktop-Erkennung
2. **LiveKit URL**: Desktop-Apps brauchen externe LiveKit URL vom Server (`/livekit/url` Endpoint)
3. **Auth**: Browser nutzt Cookies, Desktop nutzt localStorage Token + Authorization Header (via Desktop-Modul)
4. **Kein `@tauri-apps` im OSS-Code**: Alle Tauri-Imports gehören ins Desktop-Submodule, nicht in `apps/web/`

### Build Commands
```bash
# Web development
npm run dev -w @meetropolis/web

# Server
npm run dev -w @meetropolis/server

# Full Docker stack
docker compose -f docker-compose.prod.yml up --build

# Desktop (nur mit packages/desktop Submodule)
# cd packages/desktop && npm run tauri:dev
```
