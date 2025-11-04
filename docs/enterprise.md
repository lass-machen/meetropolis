# Meetropolis Enterprise – Nutzung & Setup

Dieses Dokument beschreibt, wie die Enterprise‑Erweiterung (Tenancy & Billing) in Meetropolis aktiviert und betrieben wird. Die OSS‑Basis bleibt ohne Enterprise‑Paket strikt Single‑Tenant.

## Überblick
- Enterprise‑Code liegt getrennt im Submodule `packages/tenancy-enterprise` (privates Repo).
- Das Enterprise‑Repo ist ein Monorepo mit Workspaces unter `packages/*` (z. B. `packages/tenancy`).
- Der Server lädt Enterprise‑Pakete optional via Dynamic Import; ohne Paket bleibt OSS Single‑Tenant.

## Enterprise‑Monorepo (Submodule)
- Pfad: `packages/tenancy-enterprise`
- Struktur:
  - `package.json` (workspaces: `packages/*`)
  - `packages/tenancy` → veröffentlicht als `@meetropolis/tenancy`
  - weitere zukünftige Pakete: `packages/<name>` → `@meetropolis/<name>`
- Build lokal im Enterprise‑Repo:
  - `npm -w @meetropolis/tenancy run build`
- Veröffentlichung: Private Registry empfohlen (z. B. GitHub Packages). Alternativ Submodule/CI‑Builds.

## Repository‑Checkout
```bash
git clone --recurse-submodules git@github.com:lass-machen/meetropolis.git
# Für bestehende Klone:
git submodule update --init --recursive
```

## Installation & Build (Monorepo‑Workspaces)
```bash
npm install
npm run build
```
Hinweis: `apps/server` baut isoliert im Docker‑Image ohne Enterprise‑Package. Enterprise wird nur aktiv, wenn `@meetropolis/tenancy` zur Laufzeit verfügbar ist (z. B. über private Registry oder dedizierten Build‑Pfad).

## Laufzeit‑Verhalten
- Ohne Enterprise‑Package: Single‑Tenant. Middleware hängt `DEFAULT_TENANT_SLUG` als Tenant an.
- Mit Enterprise‑Package: Multi‑Tenancy aktiviert (Subdomain/Header/Query). Billing optional mit Stripe‑ENV.

## Wichtige Umgebungsvariablen
- `DEFAULT_TENANT_SLUG=default`
- `CORS_ORIGIN`, `TRUST_PROXY`
- `DATABASE_URL`
- Optional Billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BILLING_PUBLIC_URL`

## Datenbank & Migrationen
1. `prisma migrate deploy` (im Container via Entrypoint oder manuell)
2. Seed/Backfill je nach Bestand (siehe MIGRATION.md)

## CI/CD Hinweise
- Checkout mit Submodules (`actions/checkout@v4` → `submodules: true`) ODER Pakete aus privater Registry installieren.
- Zwei Pipelines: OSS‑only (ohne Enterprise), Enterprise (mit Registry/Submodule‑Artefakt).

## Betrieb (Start)
```bash
npm run build
npm -w @meetropolis/server run prisma:generate
# Produktion: migrate deploy via Entrypoint oder manuell
```

## Testen
- OSS: `GET /` → ok; Tenants via `DEFAULT_TENANT_SLUG`.
- Enterprise: Subdomain/Header `x-tenant` testen; Limits/Seats greifen pro Tenant.

---
Troubleshooting
- 404 `tenant_not_found`: Tenant anlegen (Seed/Backfill).
- 501 `billing_not_configured`: Stripe‑ENV fehlen.
- Build findet `@meetropolis/shared` im Enterprise‑Package nicht: Workspace‑Install im Enterprise‑Repo ausführen oder private Registry verwenden.



