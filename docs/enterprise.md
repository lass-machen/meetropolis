# Meetropolis Enterprise – Nutzung & Setup

Dieses Dokument beschreibt, wie die Enterprise‑Erweiterung (Tenancy & Billing) in Meetropolis aktiviert und betrieben wird. Die OSS‑Basis bleibt ohne Enterprise‑Paket strikt Single‑Tenant.

## Überblick
- Enterprise‑Code liegt separat als Submodule/Workspace unter `packages/tenancy-enterprise` und wird als Package `@meetropolis/tenancy` geladen.
- Der Server lädt das Paket optional (Dynamic Import). Fehlt es, läuft OSS automatisch Single‑Tenant weiter.

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
Hinweis: `apps/server` deklariert `@meetropolis/tenancy` als `optionalDependency`. Ist das Submodule vorhanden, wird es als Workspace verlinkt und automatisch gefunden.

## Laufzeit‑Verhalten
- Ohne Enterprise‑Package: Single‑Tenant. `tenantMiddleware` setzt `tenantSlug = DEFAULT_TENANT_SLUG` und verzichtet auf Mandantenauflösung. Billing‑Endpunkte antworten 501, solange keine Stripe‑Keys gesetzt sind.
- Mit Enterprise‑Package: Multi‑Tenancy aktiviert (Subdomain/Header/Query-Auflösung). Billing‑Endpunkte aktivierbar via Stripe‑Keys.

## Wichtige Umgebungsvariablen
- `DEFAULT_TENANT_SLUG=default`
- `CORS_ORIGIN=https://example.com` (kommagetrennte Liste)
- `TRUST_PROXY=true` (wenn hinter Proxy/Ingress)
- Datenbank: `DATABASE_URL=postgres://...`
- Optional Billing (nur Enterprise):
  - `STRIPE_SECRET_KEY=sk_live_...`
  - `STRIPE_WEBHOOK_SECRET=whsec_...`
  - `BILLING_PUBLIC_URL=https://app.example.com`

## Datenbank & Migrationen
1. Prisma Artefakte generieren und Migrationen anwenden:
   ```bash
   npm -w @meetropolis/server run prisma:generate
   # Produktion: prisma migrate deploy (im CI/Container), lokal: prisma migrate dev
   ```
2. Backfill bestehender Daten auf einen Ziel‑Mandanten (setzt Default‑Tenant etc.):
   ```bash
   # lokal/CI (Node Tooling verfügbar)
   MIGRATE_EXISTING_TO_SLUG=default \
   npm --workspace=@meetropolis/server exec tsx src/scripts/migrateTenants.ts
   ```

## CI/CD Hinweise
- Git Checkout muss Submodule einschließen (z. B. GitHub Actions `actions/checkout@v4` mit `submodules: true`).
- Docker‑Builds: Entweder Checkout mit Submodules vor dem `docker build` oder im Dockerfile `git submodule` vermeiden und statt dessen private Registry verwenden.
- Zwei Pipelines/Jobs empfehlen sich:
  - OSS‑only: ohne Submodule/ohne Registry‑Auth, Flags/ENV ohne Stripe.
  - Enterprise: mit Submodule oder mit Registry‑Auth für `@meetropolis/tenancy`, Stripe‑Keys als Secrets.

## Betrieb (Start)
```bash
# Entwicklung
npm run dev

# Produktion – Beispiel
npm run build
npm -w @meetropolis/server run prisma:generate
prisma migrate deploy   # in der Server‑App ausführen
node apps/server/dist/index.js
```

## Testen
- OSS‑Modus: Kein Submodule → `GET /` liefert `ok`. Mandantenauflösung nutzt `DEFAULT_TENANT_SLUG`.
- Enterprise‑Modus: Submodule vorhanden → Subdomain `tenant1.example.com` oder Header `x-tenant: tenant1` setzen. Limits/Seats greifen gemäß Tenant‑Datensatz.

---
Troubleshooting
- 404 `tenant_not_found`: In Produktion werden Tenants nicht automatisch angelegt. Backfill‑Script ausführen oder Tenant manuell anlegen.
- 501 `billing_not_configured`: Stripe‑ENV sind nicht gesetzt.
- Build findet `@meetropolis/shared` im Enterprise‑Package nicht: Workspace‑Install im Monorepo ausführen (`npm install` im Repo‑Root), nicht im Submodule‑Ordner allein.


