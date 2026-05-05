# Meetropolis Brand (Private)

Privates Repository — kommerzielle Lizenz erforderlich.

Dieses Submodule enthält die Brand-Identität von Meetropolis:

- Marketing-Landing-Sections (Hero, Comparison, SocialProof, FinalCta, ProblemSolution, Pricing)
- Legal-Pages (AGB, Datenschutz, Impressum)
- Marketing-Tracking (Meta-Pixel, Konsens-Banner)
- Brand-Assets (Logo, Favicons, Produkt-Screenshots, Meetropolis-Editor-Video)
- i18n-Marketing-Strings (de/en)
- Branding-Komponenten (BrandLogo, BrandWordmark)

## Installation als Submodule

Sobald das GitHub-Repository `lass-machen/meetropolis-brand` existiert:

```bash
# Im Hauptrepo (meetropolis):
git submodule add git@github.com:lass-machen/meetropolis-brand.git packages/brand
git submodule update --init --recursive
```

## Pakete

- `packages/web` (`@meetropolis/brand-web`) — React-Komponenten + Assets, vom OSS-Web via brandLoader.ts geladen.

## Lizenz

**Kommerzielle Lizenz** — nicht open source.

Diese Module sind proprietäre Software. Unbefugte Verteilung oder Nutzung ist untersagt.

Für Lizenzanfragen: info@meetropolis.de
