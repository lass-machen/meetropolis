import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { OSS_META, readBrandMeta, injectSocialMeta, type SiteMetaProfile } from './socialMeta';

/** Minimal shell mirroring index.html's head (title + multi-line description). */
const HTML = [
  '<!doctype html>',
  '<html lang="de">',
  '  <head>',
  '    <meta charset="UTF-8" />',
  '    <title>Meetropolis</title>',
  '    <meta',
  '      name="description"',
  '      content="Self-hosted virtual office platform with spatial audio, video and a 2D world for small remote teams."',
  '    />',
  '  </head>',
  '  <body><div id="root"></div></body>',
  '</html>',
].join('\n');

const BRAND: SiteMetaProfile = {
  title: 'Meetropolis — Das Büro, das bleibt.',
  description: 'Das virtuelle Büro für Remote-Teams. DSGVO, Server in Deutschland.',
  siteName: 'Meetropolis',
  ogType: 'website',
  twitterCard: 'summary_large_image',
  locale: 'de_DE',
  siteUrl: 'https://meetropolis.me',
  ogImage: '/brand/og-image.png',
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt: 'Meetropolis OG',
};

describe('injectSocialMeta — OSS profile', () => {
  const out = injectSocialMeta(HTML, OSS_META);

  it('keeps the OSS title and description', () => {
    expect(out).toContain('<title>Meetropolis</title>');
    expect(out).toContain('content="Self-hosted virtual office platform');
  });

  it('injects OG + Twitter text tags', () => {
    expect(out).toContain('<meta property="og:title" content="Meetropolis" />');
    expect(out).toContain('<meta property="og:type" content="website" />');
    expect(out).toContain('<meta name="twitter:card" content="summary" />');
  });

  it('emits NO image tags (no absolute host at build time)', () => {
    expect(out).not.toContain('og:image');
    expect(out).not.toContain('twitter:image');
    expect(out).not.toContain('og:url');
  });
});

describe('injectSocialMeta — brand profile', () => {
  const out = injectSocialMeta(HTML, BRAND);

  it('overrides title and description with the brand copy', () => {
    expect(out).toContain('<title>Meetropolis — Das Büro, das bleibt.</title>');
    expect(out).toContain('content="Das virtuelle Büro für Remote-Teams. DSGVO, Server in Deutschland."');
    // the original OSS description must be gone
    expect(out).not.toContain('Self-hosted virtual office platform');
  });

  it('builds an absolute og:image from siteUrl + ogImage', () => {
    expect(out).toContain('<meta property="og:image" content="https://meetropolis.me/brand/og-image.png" />');
    expect(out).toContain('<meta name="twitter:image" content="https://meetropolis.me/brand/og-image.png" />');
    expect(out).toContain('<meta property="og:image:width" content="1200" />');
    expect(out).toContain('<meta property="og:image:height" content="630" />');
  });

  it('uses summary_large_image and sets locale + url', () => {
    expect(out).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(out).toContain('<meta property="og:locale" content="de_DE" />');
    expect(out).toContain('<meta property="og:url" content="https://meetropolis.me" />');
  });
});

describe('injectSocialMeta — safety', () => {
  it('is idempotent', () => {
    const once = injectSocialMeta(HTML, BRAND);
    const twice = injectSocialMeta(once, BRAND);
    expect(twice).toBe(once);
  });

  it('escapes double quotes in attribute values', () => {
    const evil: SiteMetaProfile = { ...OSS_META, description: 'a "quoted" phrase' };
    const out = injectSocialMeta(HTML, evil);
    expect(out).toContain('content="a &quot;quoted&quot; phrase"');
  });
});

describe('injectSocialMeta — comment safety (regression)', () => {
  // The real index.html has a head comment that mentions the <title> tag in
  // prose. A greedy/lazy [\s\S] title match would start inside the comment and
  // run to the real </title>, swallowing the comment's --> and blanking the
  // page. This mirrors that structure and asserts the comment stays closed.
  const HTML_WITH_COMMENT = [
    '<!doctype html>',
    '<html lang="de">',
    '  <head>',
    '    <!-- the plugin rewrites this <title>, and injects OG tags. -->',
    '    <title>Meetropolis</title>',
    '    <meta name="description" content="Self-hosted virtual office." />',
    '  </head>',
    '  <body><div id="root"></div><script type="module" src="/x.js"></script></body>',
    '</html>',
  ].join('\n');

  const balance = (s: string) => ({
    open: (s.match(/<!--/g) || []).length,
    close: (s.match(/-->/g) || []).length,
  });

  it('does not break the head comment (balanced) for the brand profile', () => {
    const out = injectSocialMeta(HTML_WITH_COMMENT, BRAND);
    const b = balance(out);
    expect(b.open).toBe(1);
    expect(b.close).toBe(1); // the comment is still closed
    expect(out).toContain('injects OG tags. -->'); // comment text intact
    expect(out).toContain('<title>Meetropolis — Das Büro, das bleibt.</title>');
    expect(out).toContain('<div id="root"></div>'); // body not commented out
    expect(out).toContain('<script type="module" src="/x.js">');
  });

  it('replaces the real title only, not the one named in the comment', () => {
    const out = injectSocialMeta(HTML_WITH_COMMENT, OSS_META);
    // the prose "<title>," inside the comment is untouched
    expect(out).toContain('rewrites this <title>, and injects OG tags. -->');
    expect(out).toContain('<title>Meetropolis</title>');
  });
});

describe('readBrandMeta', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'brandmeta-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads a valid brand-meta.json into a profile', () => {
    writeFileSync(
      join(dir, 'brand-meta.json'),
      JSON.stringify({ title: 'T', description: 'D', siteUrl: 'https://x.test', ogImage: '/a.png' }),
    );
    const m = readBrandMeta(dir);
    expect(m?.title).toBe('T');
    expect(m?.twitterCard).toBe('summary_large_image'); // default
    expect(m?.siteName).toBe('Meetropolis'); // default
  });

  it('returns null when the file is missing', () => {
    expect(readBrandMeta(join(dir, 'nope'))).toBeNull();
  });

  it('returns null when required fields are absent', () => {
    writeFileSync(join(dir, 'brand-meta.json'), JSON.stringify({ title: 'only-title' }));
    expect(readBrandMeta(dir)).toBeNull();
  });
});
