import { describe, expect, it } from 'vitest';
import { escapeHtml, stripCrlf } from './htmlUtils.js';

describe('escapeHtml', () => {
  it('returns an empty string for null/undefined/empty input', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml('')).toBe('');
  });

  it('passes through ASCII text without specials', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });

  it('escapes the five core HTML metacharacters', () => {
    expect(escapeHtml('& < > " \'')).toBe('&amp; &lt; &gt; &quot; &#39;');
  });

  it('also escapes slash and backtick (attribute-breakout vectors)', () => {
    expect(escapeHtml('/path/to`code')).toBe('&#x2F;path&#x2F;to&#x60;code');
  });

  it('escapes a <script>-injection payload', () => {
    const payload = '<script>alert("xss")</script>';
    expect(escapeHtml(payload)).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
  });

  it('coerces non-string input via String()', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(true)).toBe('true');
  });

  it('preserves DE umlauts and other non-ASCII characters', () => {
    expect(escapeHtml('Grüße & Umlaute äöüß')).toBe('Grüße &amp; Umlaute äöüß');
  });

  it('escapes ampersand exactly once (no double-encoding here)', () => {
    expect(escapeHtml('A&B&C')).toBe('A&amp;B&amp;C');
  });
});

describe('stripCrlf', () => {
  it('returns an empty string for null/undefined/empty input', () => {
    expect(stripCrlf(null)).toBe('');
    expect(stripCrlf(undefined)).toBe('');
    expect(stripCrlf('')).toBe('');
  });

  it('passes single-line strings through (trimmed)', () => {
    expect(stripCrlf('Hello World')).toBe('Hello World');
    expect(stripCrlf('  spaced  ')).toBe('spaced');
  });

  it('removes \\r\\n and collapses to a single space', () => {
    expect(stripCrlf('Subject: invite\r\nBcc: attacker@evil.test')).toBe('Subject: invite Bcc: attacker@evil.test');
  });

  it('removes standalone \\n', () => {
    expect(stripCrlf('line one\nline two')).toBe('line one line two');
  });

  it('removes standalone \\r', () => {
    expect(stripCrlf('line one\rline two')).toBe('line one line two');
  });

  it('removes Unicode line separators (NEL, LS, PS)', () => {
    expect(stripCrlf('a\u0085b\u2028c\u2029d')).toBe('a b c d');
  });

  it('collapses repeated CRLF sequences', () => {
    expect(stripCrlf('one\r\n\r\n\r\ntwo')).toBe('one two');
  });

  it('coerces non-string input via String()', () => {
    expect(stripCrlf(42)).toBe('42');
  });

  it('preserves DE umlauts in subjects', () => {
    expect(stripCrlf('Grüße aus München')).toBe('Grüße aus München');
  });
});
