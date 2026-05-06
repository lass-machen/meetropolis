import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (Prisma ≥7).
 *
 * Why this file exists:
 * - Prisma 7 prefers config-file based migrate/datasource over reading the
 *   `datasource db { url = env("DATABASE_URL") }` block from `schema.prisma`
 *   for CLI commands. The block is still required for the schema to be valid,
 *   but the URL given here takes precedence for `prisma migrate`, `db push`,
 *   `db pull`, etc.
 * - The runtime PrismaClient now needs a driver-adapter (see `src/db.ts`).
 *   That adapter is constructed inside the application — not here. The
 *   schema-engine (CLI) uses the URL from `datasource.url` below.
 *
 * Schema path: we point at the composed schema produced by
 * `prisma/compose-schema.cjs`. Run `npm run prisma:compose` before any CLI
 * invocation that goes through this config (the workspace scripts already
 * chain it, so manual `npx prisma <cmd>` calls are the only thing to watch).
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.composed.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
