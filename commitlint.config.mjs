/**
 * Conventional Commits config.
 * Matches the existing repo history (refactor/fix/chore/feat/docs/...).
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // German prose allows capitalized subjects
    // (e.g. 'feat: Brand-Submodule eingehaengt'). We keep the lower-case default.
    'subject-case': [2, 'always', ['sentence-case', 'start-case', 'pascal-case', 'upper-case', 'lower-case']],
    'body-max-line-length': [1, 'always', 120],
    'footer-max-line-length': [1, 'always', 120],
    'header-max-length': [2, 'always', 100],
  },
};
