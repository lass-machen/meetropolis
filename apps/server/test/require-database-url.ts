// Global setup of the database test projects (see vitest.config.ts).
// Fails the run before any test file loads, so nothing is skipped silently.
export default function requireDatabaseUrl(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'npm run test:db needs DATABASE_URL pointing at a migrated PostgreSQL test database ' +
        '(run `npx prisma migrate deploy` in apps/server first). See TEST_STRATEGY.md.',
    );
  }
}
