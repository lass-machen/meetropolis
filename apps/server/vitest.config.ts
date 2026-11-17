import { defineConfig } from 'vitest/config';

// Tests that need a migrated PostgreSQL database (DATABASE_URL). They run only
// through `npm run test:db`, never through `npm test`.
const databaseTestFiles = ['src/**/*.integration.test.ts'];

// Database test files with database-wide effects (triggers on shared tables,
// deletes without a tenant filter). They run after all other database tests.
const exclusiveTestFiles = [
  'src/services/restoreReplayTokenCleanup.integration.test.ts',
  'src/services/accountDeletionJournal.integration.test.ts',
  'src/services/accountDeletion.integration.test.ts',
  'src/api/routes/invites.integration.test.ts',
  'src/api/routes/auth.flow.integration.test.ts',
];

const defaultExclude = ['**/node_modules/**', '**/dist/**', '**/.git/**'];

export default defineConfig({
  test: {
    environment: 'node',
    // Align supertest's IPv4 client with the IPv6 dual-stack server it binds, so
    // the full suite stops flaking (~1 run in 4) with socket hang-ups / parse
    // errors / stray 404s under load — a mismatch invisible when a single file
    // runs in isolation. See test/setup-supertest.ts.
    setupFiles: ['./test/setup-supertest.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'server',
          // Vitest 4 narrowed the default `exclude` to just node_modules + .git, so
          // stale compiled tests in `dist/` (left over from earlier `tsc -b` runs)
          // get picked up and crash on missing build-time relative imports. Restrict
          // discovery to the source tree explicitly.
          include: ['src/**/*.test.ts'],
          exclude: [...defaultExclude, ...databaseTestFiles],
        },
      },
      // Database tests: one file at a time against the database in DATABASE_URL.
      {
        extends: true,
        test: {
          name: 'server-db',
          sequence: { groupOrder: 0 },
          fileParallelism: false,
          globalSetup: ['./test/require-database-url.ts'],
          include: databaseTestFiles,
          exclude: [...defaultExclude, ...exclusiveTestFiles],
        },
      },
      // Runs after the 'server-db' group, one file at a time.
      {
        extends: true,
        test: {
          name: 'server-db-exclusive',
          sequence: { groupOrder: 1 },
          fileParallelism: false,
          globalSetup: ['./test/require-database-url.ts'],
          include: exclusiveTestFiles,
        },
      },
    ],
  },
});
