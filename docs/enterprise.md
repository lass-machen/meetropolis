# Meetropolis Enterprise — Setup & Betrieb

Dieses Dokument beschreibt, wie das Enterprise-Submodule (Multi-Tenancy +
Billing + Admin/Billing-UI) in Meetropolis aktiviert und betrieben wird.
Die OSS-Basis bleibt ohne Enterprise-Submodule strikt Single-Tenant und
enthält keinerlei Stripe-/Billing-Code.

## Überblick

Das Enterprise-Repo `lass-machen/meetropolis-enterprise` wird als Git-Submodule
unter `packages/tenancy-enterprise/` eingebunden. Es ist ein Workspace-Monorepo
mit drei Paketen:

- `@meetropolis/tenancy` — Server-Side Tenancy-Adapter, Migrations-Runner.
- `@meetropolis/billing` — Server-Side Stripe-Integration:
  - Tenant-CRUD-Routen (`/admin/tenants*`, `/public/tenants`)
  - Pricing-Plan-CRUD (`/admin/pricing-plans*`, `/public/pricing-plans`)
  - Tenant-User-Mgmt (`/admin/tenants/:id/users*`)
  - Stripe-Billing (`/billing/*`, Webhooks, Trial, Dunning, Invoices)
  - Pack-Marketplace
  - Billing-Audit-Log
- `@meetropolis/enterprise-web` — Web-UI für die o.g. Endpoints
  (TenantsAdmin, BillingAdmin, PricingPlansAdmin, AuditLogAdmin, PackCatalog,
  BillingDashboard, PackStore).

## Repository-Checkout

```bash
git clone --recurse-submodules git@github.com:lass-machen/meetropolis.git

# Für bestehende Klone:
git submodule update --init --recursive
```

## Loader-Pattern (Lazy Loading)

Server (`apps/server/src/`):
- `tenancyLoader.ts` lädt `@meetropolis/tenancy` per Dynamic Import.
- `billingLoader.ts` lädt `@meetropolis/billing` (Trial, Dunning, Stripe-Routen).
- `adminLoader.ts` lädt Admin-Setups: `setupAdminRoutes`, `setupTenantAdminRoutes`,
  `setupPricingPlanRoutes`, `setupTenantUserRoutes`, `setupPackMarketplaceRoutes`.

Bei OSS-Builds ohne Submodule schlagen die Imports kontrolliert fehl, der OSS-
Fallback erzwingt Single-Tenant und stellt nur OSS-Routen bereit
(`/admin/health`, `/admin/stats`, `/debug/rooms`, `/public/config`).

Web (`apps/web/src/lib/enterpriseWebLoader.ts`):
- Lädt `@meetropolis/enterprise-web` per Dynamic Import.
- Liefert `AdminEnterpriseTabs`, `BillingDashboard`, `PackStore`.
- Ohne Submodule: OSS-AdminOverlay zeigt nur Maps/Health/Settings; Billing-
  Dashboard/PackStore werden gar nicht gerendert.

## Schema-Trennung

OSS-Schema (`apps/server/prisma/schema.prisma`) enthält **nur** Single-Tenant-
Felder (Tenant.id/slug/name/concurrentLimit/freeSeats/bypassLimits/
defaultMapName/publicRegistrationEnabled).

Enterprise-Erweiterungen liegen als idempotentes SQL-Fragment unter
`packages/tenancy-enterprise/prisma/migrations/20260505000001_add_enterprise_billing_schema/migration.sql`
und ergänzen bei Server-Start (via `applyEnterpriseMigrationsIfPresent`):

- `Tenant`: Stripe-/Trial-/Dunning-/Pause-Felder
- Tabellen: `PricingPlan`, `BillingAuditLog`, `AssetPackCatalog`,
  `AvatarPackCatalog`, `TenantAssetPack`, `TenantAvatarPack`
- Enum: `PackPricingModel`

Der Migrations-Runner ist `IF EXISTS`/`IF NOT EXISTS`-idempotent — er kann
ohne Datenverlust mehrmals laufen.

## Installation & Build

```bash
npm install
npm run build  # Web + Server, beides
```

## Laufzeit-Verhalten

- **Ohne Enterprise-Submodule**: Single-Tenant, 25-User-Limit aktiv,
  `/admin/tenants` etc. nicht registriert (404).
- **Mit Enterprise-Submodule + ohne Stripe-Env**: Multi-Tenancy aktiv,
  Tenant-CRUD verfügbar, aber `/billing/*`-Routen nicht gemountet
  (kein Stripe konfiguriert).
- **Mit Enterprise-Submodule + Stripe-Env**: Voller Funktionsumfang.

## Wichtige Umgebungsvariablen

- `DEFAULT_TENANT_SLUG` (default: `default`)
- `OSS_USER_LIMIT` (default: 25, Enterprise umgeht es eh)
- `PUBLIC_REGISTRATION_ENABLED` (OSS-Fallback wenn keine DB-gestützten Settings)
- `DATABASE_URL`, `JWT_SECRET`, `API_TOKEN_PEPPER`, `CORS_ORIGIN`
- Billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `BILLING_PORTAL_URL`, `BILLING_PUBLIC_URL`, `PRICING_URL`
- Email (für Dunning/Welcome): `SMTP_*` oder Provider-Keys
- Enterprise-Templates: `TEMPLATE_TENANT_SLUG`

## Verifikation

```bash
# OSS-only (Submodule nicht installiert)
curl http://localhost:2567/admin/tenants -H "Cookie: ..." # → 404
curl http://localhost:2567/public/config                  # → registrationEnabled

# Mit Enterprise
curl http://localhost:2567/admin/tenants -H "Cookie: ..." # → 200, Tenant-Liste
```

## CI/CD-Hinweise

- Workflow-Schritt `actions/checkout@v4` mit `submodules: true` für
  Enterprise-Builds.
- OSS-Build: ohne Submodule clonen, der Build muss grün sein und das resultierende
  Bundle darf keine Stripe-/Pricing-Symbole enthalten:
  ```bash
  grep -l "stripeProductId\|stripePriceId\|stripeCustomerId" apps/web/dist/assets/*.js && exit 1 || true
  ```
