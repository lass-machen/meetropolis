import { describe, it, expect } from 'vitest';
import { slugifyTeamName, SLUG_MAX_LENGTH } from './slugify';

// The rule the wizard validates the field against (RegisterStep2View).
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]{1,2}$/;

describe('slugifyTeamName', () => {
  it('lowercases and hyphenates a plain team name', () => {
    expect(slugifyTeamName('Acme Corp')).toBe('acme-corp');
  });

  it('transliterates German umlauts instead of stripping them', () => {
    expect(slugifyTeamName('Zweitläufer')).toBe('zweitlaeufer');
    expect(slugifyTeamName('Grün & Söhne')).toBe('gruen-soehne');
    expect(slugifyTeamName('Straße 5')).toBe('strasse-5');
  });

  it('strips other diacritics down to the base letter', () => {
    expect(slugifyTeamName('Café Renée')).toBe('cafe-renee');
  });

  it('collapses runs of separators and punctuation', () => {
    expect(slugifyTeamName('Acme   ///  Corp!!!')).toBe('acme-corp');
  });

  it('never emits a leading or trailing hyphen', () => {
    expect(slugifyTeamName('  -Acme-  ')).toBe('acme');
    expect(slugifyTeamName('!!!Acme!!!')).toBe('acme');
  });

  it('returns empty when nothing usable remains', () => {
    expect(slugifyTeamName('')).toBe('');
    expect(slugifyTeamName('!!!')).toBe('');
    expect(slugifyTeamName('   ')).toBe('');
  });

  it('caps the length and does not leave a trailing hyphen after the cut', () => {
    // A cut landing exactly on a hyphen must not produce "…-".
    const name = 'a'.repeat(SLUG_MAX_LENGTH) + ' tail';
    const slug = slugifyTeamName(name);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
    expect(slugifyTeamName('ab '.repeat(30))).not.toMatch(/-$/);
  });

  it('produces a value the wizard validation accepts', () => {
    for (const name of ['Acme Corp', 'Zweitläufer', 'Café Renée', 'A', 'Team 42', 'Grün & Söhne GmbH & Co. KG']) {
      const slug = slugifyTeamName(name);
      expect(slug.length).toBeGreaterThan(0);
      expect(slug).toMatch(SLUG_PATTERN);
    }
  });

  it('keeps digits and inner hyphens', () => {
    expect(slugifyTeamName('Team-42')).toBe('team-42');
  });
});
