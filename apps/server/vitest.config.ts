import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Vitest 4 narrowed the default `exclude` to just node_modules + .git, so
    // stale compiled tests in `dist/` (left over from earlier `tsc -b` runs)
    // get picked up and crash on missing build-time relative imports. Restrict
    // discovery to the source tree explicitly.
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
  },
});
