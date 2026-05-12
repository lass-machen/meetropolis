# Enterprise module (optional, closed source)

The OSS distribution is **strictly single-tenant** and ships without any
multi-tenancy, billing, or marketplace code. The corresponding features
live in a separate closed-source module operated by Tiamat UG and are not
redistributed with this codebase.

This document exists so adopters understand the optional boundary and the
runtime behaviour of the OSS-only build.

## What the OSS build does (and does not) do

Without an enterprise module loaded:

- A single tenant exists (slug configurable via `DEFAULT_TENANT_SLUG`).
- The concurrent-user limit defaults to `OSS_USER_LIMIT=25`.
- No `/admin/tenants*`, `/admin/pricing-plans*`, `/billing/*` or pack
  marketplace routes are registered (requests return `404`).
- Only the OSS-side admin endpoints are exposed:
  `/admin/health`, `/admin/stats`, `/debug/rooms`, `/public/config`.
- No Stripe, no Resend, no audit log. The server contains no Stripe
  symbols.
- The web admin overlay shows Maps / Health / Settings only. Billing
  dashboards and pack stores are not rendered.

The Prisma schema for this build includes only the single-tenant `Tenant`
columns (`id`, `slug`, `name`, `concurrentLimit`, `freeSeats`,
`bypassLimits`, `defaultMapName`, `publicRegistrationEnabled`).

## How the optional loader works

Server-side loading goes through three loaders:

- `apps/server/src/tenancyLoader.ts` — multi-tenancy adapter.
- `apps/server/src/billingLoader.ts` — Stripe, trial, dunning, webhooks.
- `apps/server/src/adminLoader.ts` — admin route registration (tenants,
  pricing plans, tenant users, pack marketplace).

Web-side loading goes through `apps/web/src/lib/enterpriseWebLoader.ts`,
which provides `AdminEnterpriseTabs`, `BillingDashboard` and `PackStore`
when an enterprise module is present.

All loaders use dynamic imports; when nothing is resolvable they fall back
to the single-tenant OSS path.

## Plugging in your own enterprise module

If you maintain a private enterprise package and want to ship a multi-tenant
build, point the loader at it by setting:

```bash
# Absolute path or path relative to the repo root.
MEETROPOLIS_ENTERPRISE_PATH=/path/to/your/enterprise/package
```

Alternatively, place a parallel checkout at `../meetropolis-enterprise`
next to this repository — the optional-submodules loader will pick it up
automatically.

The module is expected to expose three workspace packages along the lines
of `tenancy` / `billing` / `enterprise-web`. See the loader source files
listed above for the exact interfaces.

## Schema additions (when a module is loaded)

Enterprise modules typically ship their own Prisma migration fragment that
extends the OSS schema with Stripe / trial / dunning / pause columns on
`Tenant` and adds `PricingPlan`, `BillingAuditLog`, asset/avatar pack
catalog tables and a `PackPricingModel` enum. The compose-schema runner
(`apps/server/prisma/compose-schema.cjs`) merges the OSS schema with any
detected enterprise schema fragment at build time.

## Trademark and licensing note

Apache 2.0 governs the code in this repository only. Any closed-source
enterprise module is licensed separately by its operator.
