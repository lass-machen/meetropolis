# Trademarks

The name "Meetropolis", the Meetropolis logo, the Meetropolis wordmark
and related signs (the "Marks") are used by Tiamat UG to identify this
project and its commercial offerings. The Marks are **not** currently
registered trademarks. They are protected under the common-law /
use-based principles of German trademark law (§4 Nr. 2 MarkenG,
"Benutzungsmarke") and equivalent unregistered-mark doctrines in other
jurisdictions where the project is used.

This document sets out the use rules we expect from forks, derivative
projects, and commercial reusers, regardless of registration status.
The same rules will continue to apply if the Marks become registered
trademarks in the future.

The AGPL-3.0 and MIT licenses that cover the source code do **not**
grant any rights to use the Marks.

## Permitted without separate authorisation

- Accurate, factual references to the project ("based on Meetropolis"),
  provided they do not suggest endorsement, partnership or affiliation.
- Independent self-hosted deployments under your own branding (see
  "If you fork or self-host" below).

## Not permitted without prior written authorisation

- Use of the Marks in product names, domains, logos or marketing
  material in a way that suggests affiliation, sponsorship or official
  distribution.
- Rebranding or forks that adopt the Marks or use a name confusingly
  similar to them.
- Publishing a fork under the name "Meetropolis", a derivative spelling
  (for example "Meetropolis Cloud" or "MyMeetropolis") or a similarly
  sounding domain.

## If you fork or self-host

The public OSS repository intentionally ships **no** brand assets or
marketing copy. The following areas are reserved for the private,
closed-source modules operated by Tiamat and are protected by this
policy:

- Marketing landing sections (Hero, Pricing, Comparison, Social Proof,
  Final CTA, Problem/Solution)
- Legal pages (Terms of Service, Privacy Policy, Imprint) with
  Meetropolis-specific content
- Brand logo, wordmark, favicons, product screenshots, editor video
- Meta-Pixel tracking integration
- Multi-tenant administration, Stripe billing, pricing-plan CRUD,
  asset-pack marketplace, audit log

If you host the project yourself or use it commercially, you are
expected to:

1. Place your own branding assets under `apps/web/public/brand/` (the
   OSS repository ships this directory as a placeholder slot).
2. Provide your own legal pages (Privacy Policy, Terms, Imprint).
3. Adjust the HTML title and favicon path in `apps/web/index.html`.
4. If you want marketing tracking, set your own `VITE_META_PIXEL_ID`.
   Do not reuse the Meetropolis pixel ID under any circumstances.
5. Replace source-code strings that prominently use the "Meetropolis"
   name with your own branding.

## Contact

For licence requests or questions: mail@meetropolis.me
