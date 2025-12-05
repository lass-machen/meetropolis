# Claude Code Instructions

**IMPORTANT: Always read `/AGENTS.md` first before making any changes to this codebase.**

## Quick Reference

### Monorepo Structure
- `apps/server`: Express + Colyseus + Prisma
- `apps/web`: React + Vite + Phaser + Tauri Desktop
- `packages/shared`: Shared types and utilities

### Key Files for Context
- `/AGENTS.md` - Development guidelines, quality budgets, architecture rules
- `/README.md` - Project overview and setup
- `/docker-compose.prod.yml` - Production deployment config

### Tauri Desktop App
The web app can be built as a native desktop app using Tauri v2:
- Config: `apps/web/src-tauri/`
- Uses `window.__MEETROPOLIS_API_BASE__` for API URL (set by Tauri bridge)
- Cookies don't work in WKWebView - use token auth with `Authorization` header
- CORS requires `tauri://localhost` origin

### Common Gotchas
1. **API Base URL**: In Tauri, always check `window.__MEETROPOLIS_API_BASE__` or `window.desktop?.apiBase` before using env vars
2. **LiveKit URL**: Tauri apps need external LiveKit URL from server (`/livekit/url` endpoint)
3. **Auth**: Browser uses cookies, Tauri uses localStorage token + Authorization header
4. **CORS**: Production needs `tauri://localhost` in allowed origins

### Build Commands
```bash
# Web development
npm run dev -w @meetropolis/web

# Tauri desktop (from apps/web)
npm run tauri dev    # Development
npm run tauri build  # Production build

# Server
npm run dev -w @meetropolis/server

# Full Docker stack
docker compose -f docker-compose.prod.yml up --build
```
