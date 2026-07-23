import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma CLI invokes this file with cwd=apps/server, so a plain
// `dotenv/config` would only see apps/server/.env (which we do not ship).
// Resolve the repo-root .env explicitly so DATABASE_URL flows through to
// the schema engine for `prisma generate`, `prisma db push`, etc.
const here = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(here, '..', '..', '.env') });

/**
 * Prisma CLI configuration (Prisma ≥7).
 *
 * Why this file exists:
 * - Prisma 7 prefers config-file based migrate/datasource over reading the
 *   `datasource db { url = env("DATABASE_URL") }` block from `schema.prisma`
 *   for CLI commands. The block is still required for the schema to be valid,
 *   but the URL given here takes precedence for `prisma migrate`, `db push`,
 *   `db pull`, etc.
 * - The runtime PrismaClient needs a driver-adapter (see `src/db.ts`).
 *   That adapter is constructed inside the application — not here. The
 *   schema-engine (CLI) uses the URL from `datasource.url` below.
 *
 * Schema path: the OSS schema is the single source of truth. Optional
 * commercial modules ship their own composed schema and pass it through
 * `--schema` explicitly; they do not use this config file.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
