# Claude Code Instructions

**WICHTIG: Vor Aenderungen an diesem Code immer zuerst `/AGENTS.md` lesen.**

## Quick Reference

### Monorepo-Struktur

- `apps/server`: Express + Colyseus + Prisma
- `apps/web`: React + Vite + Phaser
- `apps/npc-service`: NPC-Automation-Service (Docker-Profile `npc`)
- `apps/loadtest`: Load-Test-Harness (Docker-Profile `loadtest`)
- `packages/shared`: Shared Types und Utilities

### Wichtige Files

- `/AGENTS.md` - Development-Guidelines, Quality-Budgets, Architecture-Rules
- `/README.md` - Projektueberblick und Setup
- `/compose.yaml` - Lokaler Dev-Stack (Core + optionale Profiles)

### Optionale Closed-Source-Module

Brand, Enterprise und Desktop werden ueber dynamische Imports an klar
definierten Loader-Boundaries eingebunden. Im OSS-Build resolvern diese
Loader zu `null`; der App-Code degradiert graceful:

- `apps/server/src/{tenancyLoader,billingLoader,adminLoader}.ts`
- `apps/web/src/lib/{enterpriseWebLoader,brandLoader,desktopLoader}.ts`
- `apps/web/optional-submodules.ts`

Pfade werden ueber `MEETROPOLIS_{BRAND,ENTERPRISE,DESKTOP}_PATH` env vars
oder sibling-clones im Eltern-Ordner geladen. Siehe `docs/brand.md` und
`docs/enterprise.md`.

### Common Gotchas

1. **API Base URL**: Desktop-Clients setzen `window.__MEETROPOLIS_API_BASE__` — der Code nutzt das Flag fuer Desktop-Erkennung.
2. **LiveKit URL**: Desktop-Apps holen die externe LiveKit-URL vom Server (`/livekit/url`-Endpoint).
3. **Auth**: Browser nutzt Cookies, Desktop nutzt localStorage-Token + Authorization-Header (via Desktop-Modul).
4. **Kein `@tauri-apps` im OSS-Code**: Alle Tauri-Imports gehoeren ins Desktop-Modul, niemals in `apps/web/`.

### Build Commands

```bash
# Web-Development
npm run dev -w @meetropolis/web

# Server
npm run dev -w @meetropolis/server

# Voller Docker-Stack (lokal)
docker compose up

# Mit optionalen Services
docker compose --profile monitoring --profile npc up
```
