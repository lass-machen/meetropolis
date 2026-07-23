/**
 * Derive a workspace identifier from a team name.
 *
 * The signup wizard proposes this while the user types the team name, so it has
 * to satisfy the same rule the field validates against: lowercase a-z0-9 and
 * inner hyphens, never leading or trailing ones. German teams are the common
 * case, so umlauts get their conventional transliteration (ä -> ae) rather than
 * the accent-stripping NFD default (ä -> a), which would turn "Zweitläufer"
 * into "zweitlaufer".
 */

/** Transliterations that must not be reduced to a bare base letter. */
const TRANSLITERATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/ø/g, 'oe'],
  [/å/g, 'aa'],
];

/** Longest slug the wizard proposes; the field itself accepts more. */
export const SLUG_MAX_LENGTH = 40;

/**
 * Slugify a team name into a candidate workspace identifier.
 * Returns '' when nothing usable remains (e.g. a name of only punctuation),
 * which the caller shows as an empty field rather than a nonsense proposal.
 */
export function slugifyTeamName(name: string): string {
  const transliterated = TRANSLITERATIONS.reduce((acc, [re, to]) => acc.replace(re, to), name.toLowerCase());
  return (
    transliterated
      // Strip remaining diacritics (é -> e) without touching the pairs above.
      // ̀-ͯ is the combining-marks block NFD splits them into.
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      // Anything not slug-legal becomes a separator, then collapse runs.
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, SLUG_MAX_LENGTH)
      // A trailing hyphen can reappear after the length cut.
      .replace(/-$/, '')
  );
}
