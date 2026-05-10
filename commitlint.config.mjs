/**
 * Conventional Commits config.
 * Passt zur bestehenden Repo-Historie (refactor/fix/chore/feat/docs/...).
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Deutscher Sprachgebrauch erlaubt Subject in Großbuchstaben am Anfang
    // (z.B. "feat: Brand-Submodule eingehängt"). Wir behalten lower-case-Default.
    'subject-case': [2, 'always', ['sentence-case', 'start-case', 'pascal-case', 'upper-case', 'lower-case']],
    'body-max-line-length': [1, 'always', 120],
    'footer-max-line-length': [1, 'always', 120],
    'header-max-length': [2, 'always', 100],
  },
};
