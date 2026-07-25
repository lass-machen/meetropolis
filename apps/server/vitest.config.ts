import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Align supertest's IPv4 client with the IPv6 dual-stack server it binds, so
    // the full suite stops flaking (~1 run in 4) with socket hang-ups / parse
    // errors / stray 404s under load — a mismatch invisible when a single file
    // runs in isolation. See test/setup-supertest.ts.
    setupFiles: ['./test/setup-supertest.ts'],
    // Vitest 4 narrowed the default `exclude` to just node_modules + .git, so
    // stale compiled tests in `dist/` (left over from earlier `tsc -b` runs)
    // get picked up and crash on missing build-time relative imports. Restrict
    // discovery to the source tree explicitly.
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
  },
});
