# Brand module (optional, closed source)

The OSS distribution intentionally ships **without** Meetropolis-specific
branding. Landing pages, legal copy, marketing tracking and product imagery
all live in a separate closed-source repository operated by Tiamat UG and
are not redistributed with this codebase.

This document exists so adopters understand how the optional boundary works
and what they would need to provide if they wanted to wire in their own
marketing shell.

## How the optional loader works

Web-side loading goes through `apps/web/src/lib/brandLoader.ts`. The loader
uses a dynamic import; when no brand module is resolvable it returns `null`
and the app falls back to neutral, generic chrome:

- `LandingPage.tsx` renders the lightweight `OssHeroSection.tsx` and
  `OssFinalCtaSection.tsx`. Marketing sections
  (Comparison, Social Proof, Pricing, Problem/Solution) remain empty.
- `/privacy`, `/terms`, `/impressum` show a neutral placeholder telling
  self-hosters to provide their own legal pages.
- `<PublicConsentGate>` renders nothing, so no third-party tracking pixel
  ever fires.
- `<AppShell>` renders a generic logo placeholder and the word "Workspace"
  instead of a product name.

## Plugging in your own brand bundle

If you maintain a private brand package and want to ship a branded build,
point the loader at it by setting:

```bash
# Absolute path or path relative to the repo root.
MEETROPOLIS_BRAND_PATH=/path/to/your/brand/package
```

Alternatively, place a parallel checkout of a brand package at
`../meetropolis-brand` next to this repository — the optional-submodules
loader will pick it up automatically.

The package is expected to expose:

- Marketing landing sections (HeroSection, ComparisonSection, etc.)
- Legal pages (TermsOfService, PrivacyPolicy, Impressum)
- A cookie-consent gate (e.g. for a tracking pixel)
- Branding components (BrandLogo, BrandWordmark)
- Marketing i18n bundles (`marketing.json` for `de`, `en`)

See `apps/web/src/lib/brandLoader.ts` for the exact shape the loader
expects.

## Brand assets

`apps/web/public/brand/` contains a `.gitkeep` only. Self-hosters drop their
own `logo.png` and `favicon.png` here and adjust the favicon path in
`apps/web/index.html` plus the `<title>` tag.

## Marketing tracking

The default build performs no marketing tracking. If a brand bundle is
provided and you want it to fire a tracking pixel, configure
`VITE_META_PIXEL_ID` (or whichever variable your bundle reads) and ensure
the consent gate is wired up.

## Trademark note

The Meetropolis name, logo, fonts and product imagery are trademarks of
Tiamat UG and are **not** licensed under Apache 2.0. Do not republish them
as part of a derivative product. See [`../TRADEMARKS.md`](../TRADEMARKS.md).
