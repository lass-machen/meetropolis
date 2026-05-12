# Markenrichtlinie (Trademarks)

Die Namen „Meetropolis", das Meetropolis-Logo, das Meetropolis-Wordmark sowie
zugehörige Markenzeichen sind Marken der jeweiligen Rechteinhaber (nachfolgend
„Marken").

Die Apache-2.0-Lizenz gewährt **keine** Rechte zur Nutzung der Marken.

## Erlaubt ohne gesonderte Genehmigung

- Wahrheitsgemäße Referenzierung des Projekts („basiert auf Meetropolis"),
  sofern keine Unterstützung/Partnerschaft suggeriert wird.
- Eigenständige Self-Hosted-Deployments unter eigenem Branding (siehe
  „Beim Forken/Self-Hosting" weiter unten).

## Nicht erlaubt ohne vorherige schriftliche Genehmigung

- Nutzung der Marken in Produktnamen, Domains, Logos oder Marketingmaterialien,
  die Zugehörigkeit, Sponsoring oder offizielle Distribution suggerieren.
- Rebranding/Forks, die die Marken übernehmen oder verwechselbar ähnlich sind.
- Veröffentlichung eines Forks unter dem Namen „Meetropolis", einer
  abgeleiteten Schreibweise (z. B. „Meetropolis Cloud", „MyMeetropolis")
  oder einer ähnlich klingenden Domain.

## Beim Forken/Self-Hosting

Das öffentliche OSS-Repository enthält **bewusst keine** Marken-Assets oder
Marketing-Inhalte mehr. Die folgenden Bereiche sind ausschließlich in den
privaten, closed-source Modulen von Tiamat verfügbar (siehe
`docs/brand.md`, `docs/enterprise.md`) — und damit von dieser
Markenrichtlinie geschützt:

- Marketing-Landing-Sections (Hero, Pricing, Comparison, Social Proof,
  Final CTA, Problem/Solution)
- Legal-Pages (AGB, Datenschutz, Impressum) mit Meetropolis-spezifischen
  Inhalten
- Brand-Logo, Wordmark, Favicons, Produkt-Screenshots, Editor-Video
- Meta-Pixel-Tracking-Integration
- Multi-Tenant-Verwaltung, Stripe-Billing, Pricing-Plan-CRUD,
  Pack-Marketplace, Audit-Log

Wenn Sie das Projekt selbst hosten oder kommerziell nutzen wollen, sind Sie
verpflichtet:

1. Eigene Branding-Assets unter `apps/web/public/brand/` ablegen
   (Platzhalter-Verzeichnis im OSS-Repo).
2. Eigene Legal-Pages (Datenschutz, AGB, Impressum) bereitstellen.
3. Den HTML-Title und Favicon-Pfad anpassen (`apps/web/index.html`).
4. Wenn Marketing-Tracking gewünscht: eigene `VITE_META_PIXEL_ID` setzen,
   keinesfalls die Meetropolis-Pixel-ID verwenden.
5. Eine Modifikation der Quellcode-Strings, soweit sie die Marke „Meetropolis"
   prominent verwenden, durch eigene Bezeichnungen ersetzen.

## Kontakt

Für eine Lizenz/Genehmigung oder Fragen: info@meetropolis.de
