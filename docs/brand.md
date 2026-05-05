# Meetropolis Brand — Setup & Betrieb

Dieses Dokument beschreibt das Brand-Submodule (Marketing-Landing, Legal-Pages,
Brand-Assets, Marketing-Tracking). Das OSS-Repository enthält **bewusst keine**
Meetropolis-spezifischen Brand-Inhalte.

## Überblick

Das Brand-Repo `lass-machen/meetropolis-brand` wird als Git-Submodule unter
`packages/brand/` eingebunden. Es enthält ein Workspace-Paket:

- `@meetropolis/brand-web` — Marketing-Landing-Sections (HeroSection,
  ComparisonSection, SocialProofSection, FinalCtaSection, ProblemSolutionSection,
  PricingSection), Legal-Pages (TermsOfService, PrivacyPolicy, Impressum),
  Cookie-Consent-Banner mit Meta-Pixel-Integration, Branding-Komponenten
  (BrandLogo, BrandWordmark), Marketing-i18n-Strings (de/en) und Brand-Assets
  unter `public/`.

## Repository-Checkout

```bash
git submodule add git@github.com:lass-machen/meetropolis-brand.git packages/brand
git submodule update --init --recursive
```

## Loader-Pattern

Web-seitig läuft alles über `apps/web/src/lib/brandLoader.ts`. Es lädt
`@meetropolis/brand-web` per Dynamic Import. Ohne Submodule:

- `LandingPage.tsx` rendert den schmalen `OssHeroSection.tsx` und
  `OssFinalCtaSection.tsx` (generisch, ohne Brand). Marketing-Sections
  (Comparison, Social Proof, Pricing, Problem/Solution) bleiben leer.
- `/privacy`, `/terms`, `/impressum` zeigen einen neutralen Hinweis, dass
  Self-Hoster eigene Legal-Pages bereitstellen müssen.
- `<PublicConsentGate>` rendert nichts → kein Meta-Pixel-Request.
- `<AppShell>` (App-Header) zeigt einen generischen Logo-Platzhalter und das
  Wort "Workspace" statt "Meetropolis".

## Brand-Assets

Im OSS-Repo unter `apps/web/public/brand/` liegt nur eine `.gitkeep`-Datei.
Self-Hoster legen dort eigene Logos ab (`logo.png`, `favicon.png`) und passen
`apps/web/index.html:7` (Favicon-Pfad) sowie ggf. den `<title>` an.

Die Original-Meetropolis-Assets (Logo, Favicons, Editor-Video,
Produkt-Screenshots) liegen ausschließlich im Brand-Submodule
unter `packages/brand/packages/web/public/`.

## i18n

OSS-Locales (`apps/web/src/locales/{de,en}/public.json`) enthalten nur
generische Strings (Header, Trust-Bar, Features, How-It-Works, FAQ,
Open-Source, Footer, Auth, Legal-Layout, Verify).

Marketing-Strings (Hero/Problem/Solution/Comparison/Social/Pricing/CTA/
Consent/Billing) liegen im Brand-Submodule unter
`packages/brand/packages/web/src/locales/{de,en}/marketing.json`.

Falls weiteres i18n-Setup gewünscht: Marketing-Bundle in i18next via
`addResourceBundle('de'|'en', 'marketing', marketingDe|marketingEn)` nachladen
(siehe `BrandModule.marketingDe/marketingEn` im `brandLoader.ts`).

## Marketing-Tracking

Die hartcodierte Meta-Pixel-ID des Originals liegt im Brand-Submodule unter
`packages/brand/packages/web/src/consent/PublicConsentGate.tsx`. Self-Hoster
mit eigenem Tracking sollten:

- Eine eigene Pixel-ID konfigurieren (`VITE_META_PIXEL_ID` env)
- Den `PublicConsentGate` so anpassen, dass er die env-Variable liest
- Die Cookie-Consent-Texte in den eigenen i18n-Strings überschreiben

## Verifikation

OSS-Bundle (ohne Brand-Submodule) darf folgendes nicht enthalten:

```bash
# Meta-Pixel-ID & Facebook
grep -l "1878721026864311\|connect.facebook.net" apps/web/dist/assets/*.js && exit 1

# Meetropolis-Marketing-Texte
grep -lE "Meetropolis (is|puts|virtual office)" apps/web/dist/assets/*.js && exit 1

# Brand-Asset-Pfade
ls apps/web/public/images/pub/meetropolis-* 2>/dev/null && exit 1
```

## CI/CD-Hinweise

Drei Build-Pipelines:

1. **OSS-only**: kein Brand-, kein Enterprise-Submodule. Build, Tests, und
   die obigen Negativ-Checks. Resultat ist ein deploybares OSS-Image.
2. **OSS + Brand**: Brand-Submodule installiert, kein Enterprise.
   Marketing-Landing aktiv, Tracking aktiv, aber Server bleibt Single-Tenant.
3. **Full**: alle drei Submodules. Voller Funktionsumfang.

Für Pipeline 1 reicht im GitHub-Actions-Workflow `submodules: false`. Für
Pipelines 2 und 3 entweder `submodules: recursive` mit SSH-Keys oder selektive
`git submodule update`-Aufrufe.
