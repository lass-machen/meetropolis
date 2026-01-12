# Mandanten-Fähigkeit + Seats + Stripe – Deployment & Migration

Diese Anleitung beschreibt Schritt für Schritt das Update des Live-Systems auf Mandantenbetrieb (Subdomain), die Migration bestehender Daten und die Aktivierung des Abo-Backends (Stripe). Beispiel-Mandant für die Live-Seite: `acme`.

## 1) Vorbereitungen

- DNS/Wildcard: `*.meine-domain.de` → Frontend/Backend-Loadbalancer routen
- Live-Mandant: `acme.meine-domain.de` (Frontend) + Backend gleicher Host (CORS beachten)
- ENV Variablen (Server):
  - `JWT_SECRET` (prod, required)
  - `DATABASE_URL` (Postgres)
  - `PORT=2567`
  - `TRUST_PROXY=true` (falls hinter LB/Ingress)
  - `CORS_ORIGIN=https://acme.meine-domain.de,https://<weitere-subdomains>`
  - `DEFAULT_TENANT_SLUG=default` (optional)
  - `FREE_SEATS_DEFAULT=3` (optional, globaler Default für neue Mandanten; effektiver Default ist `internal.freeSeats` > ENV > 3)
  - Stripe (für Billing):
    - `STRIPE_SECRET_KEY=sk_live_...`
    - `STRIPE_WEBHOOK_SECRET=whsec_...`
    - `BILLING_PUBLIC_URL=https://acme.meine-domain.de`
    - Preise (optional Mapping per Plan, sonst `priceId` im Request senden):
      - `STRIPE_PRICE_BASIC=price_...`
      - `STRIPE_PRICE_PRO=price_...`
    - WICHTIG: Price-/Product-Metadaten `concurrent_limit=<int>` pflegen
  - Free-Limit (immer frei): pro Tenant einstellbar als `freeSeats` (Default 3) über die Admin-UI. Effektives Limit = max(concurrentLimit, freeSeats) außer `bypassLimits`.

## 2) Server-Code aktualisieren

- Repo aktualisieren (main pullen)
- Im Monorepo-Root: `npm install`
- Im Server: `npm -w @meetropolis/server run build`

## 3) Datenbank migrieren

- Prisma Migrations deployen:
  - `npm -w @meetropolis/server run prisma:generate`
  - `npx prisma migrate deploy`
- Seed (legt `internal`, `default`, Admin-User und Basisdaten an):
  - `npm -w @meetropolis/server run prisma:seed`
- Bestandsdaten auf Ziel-Mandant verschieben (Standard: `acme`):
  - ENV setzen (einmalig während Migration): `MIGRATE_EXISTING_TO_SLUG=acme`
  - Script ausführen:
    - Dev: `npx tsx apps/server/src/scripts/migrateTenants.ts`
    - Build: `node apps/server/dist/src/scripts/migrateTenants.js`

### Produktionsmigration (ohne Reset)

Hinweis: In PROD niemals `db push --force-reset` verwenden. Stattdessen zweistufige Migration ausrollen:

1. Phase A (non-breaking Schema):
   - Neue Tabellen: `Tenant`, `Membership`.
   - Neue Spalten (z. B. `tenantId` in `Map/Room/Zone/Presence/Invite`, `freeSeats`): zunächst NULL-able hinzufügen.
   - Eindeutige Keys vorbereiten (z. B. zusätzliche UNIQUE-Indices mit `tenantId,name`), alte UNIQUEs vorerst bestehen lassen.
   - Als Migrationsdatei ausliefern und mit `npx prisma migrate deploy` anwenden.

2. Backfill:
   - `MIGRATE_EXISTING_TO_SLUG=acme` setzen.
   - `node apps/server/dist/src/scripts/migrateTenants.js` ausführen (ordnet alle Bestandsdaten dem Ziel-Tenant zu und legt Memberships an).

3. Phase B (Constraints festziehen):
   - `tenantId`-Spalten auf NOT NULL setzen.
   - Alte UNIQUE-Constraints entfernen/ersetzen durch `@@unique([tenantId,name])` (wo vorgesehen).
   - Als zweite Migration deployen (`npx prisma migrate deploy`).

Wartungsfenster kurz einplanen (Schema + Backfill); kein Datenverlust, kein Reset.

Ergebnis:
- Tenant `acme` existiert mit `bypassLimits=true` und `concurrentLimit=999999`.
- Alle alten `maps/rooms/zones/presences/invites` sind `acme` zugeordnet.
- Alle vorhandenen `users` haben `Membership` in `acme`.

## 4) Start/Restart Server

- Container/Service neu starten
- Logs prüfen: `Server listening on :2567`

## 5) Stripe Webhook konfigurieren

- In Stripe: Webhook Endpoint `POST https://acme.meine-domain.de/billing/webhook`
- Events aktivieren: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`
- Secret in ENV `STRIPE_WEBHOOK_SECRET` hinterlegen

## 6) Admin-Zugriff

- Seeded Admin (`SEED_ADMIN_EMAIL`) ist `internal`-Owner → Admin-Button oben rechts sichtbar
- Admin-UI Tabs:
  - „Mandanten“: Liste, Online-Usage, Limit, Free-Limit, Bypass, Status
  - „Pakete & Billing“: Stripe-Produkte/Preise (CRUD) und Umsatz-Kacheln (aktive Subs, MRR, Umsatz 30 Tage)
- Button „Mandant 'acme' sicherstellen“ legt den Mandanten an, falls nicht vorhanden

## 7) Smoke-Tests (manuell)

- Tenant-Isolation:
  - Auf `acme.meine-domain.de` einloggen → funktioniert
  - Anderen Subdomain-Tenant anlegen (Admin-UI), User ohne Membership: Login liefert `403 not_member_of_tenant`
- Seats-Grenze (Limit):
  - In Admin-UI Test-Tenant anlegen, `concurrentLimit=2`, `bypassLimits=false`
  - Mit 2 Browsern joinen → ok; 3. Join → Colyseus beendet Join mit `tenant_limit_reached`
- LiveKit-Token (Tenant-gekoppelt):
  - AV verbindet, `/livekit/token` hängt Raum `tenantSlug:roomName` an
- Stripe Checkout:
  - POST `/billing/checkout-session` mit `{ priceId }` → URL öffnen, Checkout durchführen
  - Nach `checkout.session.completed` sollte `tenant.concurrentLimit` je nach Price-Metadaten gesetzt sein
  - Portal: POST `/billing/portal-session` liefert Portal-URL
- Admin Billing:
  - GET `/admin/billing/products` listet Produkte/Preise, inkl. `metadata.concurrent_limit`
  - POST `/admin/billing/products` legt Produkt + Preis an
  - POST `/admin/billing/products/:id/prices` fügt Preis hinzu
  - PATCH `/admin/billing/products/:id` bzw. `/admin/billing/prices/:id` toggelt `active`
- Webhook:
  - Stripe Dashboard → „Send test event“ (`customer.subscription.updated`) mit passendem `price` (metadata.concurrent_limit)
  - Prüfen: DB `Tenant.concurrentLimit` aktualisiert; `stripeCustomerId`, `stripeSubscriptionId` befüllt

## 8) Rollback-Hinweis

- Migration ist additive. Vorher Backup/Point-in-Time-Recovery konfigurieren
- Rollback: Code zurück, Migrations-Schema rückgängig machen (nicht empfohlen), oder frische Datenbank vom Backup

## 9) Hinweise

- `acme` bleibt ohne Limit (bypassLimits=true) – kein Stripe-Zwang
- Weitere Tenants können per Admin-UI angelegt/verwaltet werden
- Für horizontale Skalierung (mehrere Instanzen) empfiehlt sich für Seats eine zentrale Zählung (Redis) – TODO Follow-up

## 10) Self‑Serve Signup (Mandant registrieren)

- Öffentliche Seite im Login-Screen: Formular „Registrieren (neuen Mandanten anlegen)“
- Endpoint: `POST /public/tenants`
  - Body: `{ slug: string, name: string, email: string, password: string }`
  - Server setzt `freeSeats` automatisch auf den globalen Default (`internal.freeSeats` > `FREE_SEATS_DEFAULT` > 3)
  - Erstellt Nutzer (Owner) + Membership, setzt Login-Cookie und antwortet mit Tenant-Daten
- Redirect: Nach Erfolg automatische Weiterleitung auf Subdomain `https://<slug>.<base-domain>` (lokal: Reload)

---

## API-Referenzen (Billing)

- `POST /billing/checkout-session`
  - body: `{ priceId?: string, plan?: string, returnUrl?: string }`
  - Antwort: `{ url: string }`
- `POST /billing/portal-session`
  - Antwort: `{ url: string }`
- `POST /billing/webhook` – Stripe sendet Events; keine Auth; raw body erforderlich


