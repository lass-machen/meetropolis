/**
 * Social / SEO meta injection for the static index.html (open-core seam).
 *
 * Social crawlers (Slack, WhatsApp, LinkedIn, X, Facebook) do NOT execute the
 * SPA, so the runtime `document.title` override (useDocumentTitle) is invisible
 * to them. The tags they read must live in the STATIC HTML. This module builds
 * those tags at build time; the optionalSubmodules plugin injects them via a
 * `transformIndexHtml` hook.
 *
 * Two profiles:
 *  - OSS default (`OSS_META`): plain product identity, text-only preview. No
 *    `og:image`, because a self-hoster's canonical host is unknown at build
 *    time — an absolute image URL (which OG requires) cannot be formed.
 *  - Brand: read from the resolved brand package's `brand-meta.json` when the
 *    brand submodule is present (`readBrandMeta`). It carries the commercial
 *    title, description, canonical site URL and the 1200x630 `og:image`. The
 *    marketing copy lives in the brand repo, never in this OSS file.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface SiteMetaProfile {
  title: string;
  description: string;
  siteName: string;
  /** OpenGraph object type, always `website` for the app shell. */
  ogType: string;
  twitterCard: 'summary' | 'summary_large_image';
  /** OG locale, e.g. `de_DE`. Brand only. */
  locale?: string;
  /** Absolute canonical site URL (no trailing slash needed). Brand only. */
  siteUrl?: string;
  /** Image path relative to the site root, e.g. `/brand/og-image.png`. Brand only. */
  ogImage?: string;
  ogImageWidth?: number;
  ogImageHeight?: number;
  ogImageAlt?: string;
}

/**
 * OSS product identity. This is the only social copy that legitimately lives in
 * the OSS tree; it mirrors the `<title>` and description already in index.html.
 * Text-only preview by design (no absolute host → no og:image).
 */
export const OSS_META: SiteMetaProfile = {
  title: 'Meetropolis',
  description: 'Self-hosted virtual office platform with spatial audio, video and a 2D world for small remote teams.',
  siteName: 'Meetropolis',
  ogType: 'website',
  twitterCard: 'summary',
};

/** Marker used to keep injection idempotent across repeated transform calls. */
const INJECTED_MARKER = 'property="og:title"';

function escAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Read the brand package's build-time meta. Returns null on any problem (file
 * missing, malformed JSON, required fields absent) so the caller falls back to
 * OSS_META — a broken brand file must never break the build.
 */
export function readBrandMeta(brandDir: string): SiteMetaProfile | null {
  try {
    const raw = readFileSync(resolve(brandDir, 'brand-meta.json'), 'utf8');
    const m = JSON.parse(raw) as Partial<SiteMetaProfile>;
    if (!m || typeof m.title !== 'string' || typeof m.description !== 'string') return null;
    // Build conditionally: exactOptionalPropertyTypes forbids assigning an
    // explicit `undefined` to an optional field, so only set what is present.
    const profile: SiteMetaProfile = {
      title: m.title,
      description: m.description,
      siteName: typeof m.siteName === 'string' ? m.siteName : 'Meetropolis',
      ogType: typeof m.ogType === 'string' ? m.ogType : 'website',
      twitterCard: m.twitterCard === 'summary' ? 'summary' : 'summary_large_image',
    };
    if (m.locale !== undefined) profile.locale = m.locale;
    if (m.siteUrl !== undefined) profile.siteUrl = m.siteUrl;
    if (m.ogImage !== undefined) profile.ogImage = m.ogImage;
    if (m.ogImageWidth !== undefined) profile.ogImageWidth = m.ogImageWidth;
    if (m.ogImageHeight !== undefined) profile.ogImageHeight = m.ogImageHeight;
    if (m.ogImageAlt !== undefined) profile.ogImageAlt = m.ogImageAlt;
    return profile;
  } catch {
    return null;
  }
}

/** Absolute image URL (OG requires absolute) or null when it cannot be formed. */
function absoluteImage(p: SiteMetaProfile): string | null {
  if (!p.siteUrl || !p.ogImage) return null;
  return `${p.siteUrl.replace(/\/+$/, '')}/${p.ogImage.replace(/^\/+/, '')}`;
}

function buildTags(p: SiteMetaProfile): string[] {
  const prop = (k: string, v: string) => `<meta property="${k}" content="${escAttr(v)}" />`;
  const name = (k: string, v: string) => `<meta name="${k}" content="${escAttr(v)}" />`;
  const tags = [
    prop('og:type', p.ogType),
    prop('og:site_name', p.siteName),
    prop('og:title', p.title),
    prop('og:description', p.description),
  ];
  if (p.locale) tags.push(prop('og:locale', p.locale));
  if (p.siteUrl) tags.push(prop('og:url', p.siteUrl));
  const img = absoluteImage(p);
  if (img) {
    tags.push(prop('og:image', img));
    if (p.ogImageWidth) tags.push(prop('og:image:width', String(p.ogImageWidth)));
    if (p.ogImageHeight) tags.push(prop('og:image:height', String(p.ogImageHeight)));
    tags.push(prop('og:image:alt', p.ogImageAlt ?? p.title));
  }
  tags.push(name('twitter:card', p.twitterCard));
  tags.push(name('twitter:title', p.title));
  tags.push(name('twitter:description', p.description));
  if (img) tags.push(name('twitter:image', img));
  return tags;
}

/**
 * Pure transform: set `<title>` and the description meta to the profile's
 * values and inject the OG/Twitter tag block before `</head>`. Idempotent — a
 * second call detects the marker and returns the html unchanged.
 */
export function injectSocialMeta(html: string, p: SiteMetaProfile): string {
  if (html.includes(INJECTED_MARKER)) return html;
  // `[^<]*` (not `[\s\S]*?`) so the match cannot start at a literal `<title>`
  // that appears inside an HTML comment and run across the comment's closing
  // `-->` to the real `</title>` — that would swallow the `-->`, leave the
  // comment open and blank the page. A real title tag holds no `<`.
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${escAttr(p.title)}</title>`);
  out = out.replace(
    /<meta\s+name="description"[\s\S]*?>/,
    `<meta name="description" content="${escAttr(p.description)}" />`,
  );
  const block = buildTags(p).join('\n    ');
  return out.replace('</head>', `    ${block}\n  </head>`);
}
