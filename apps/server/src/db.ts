import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/index.js';

/**
 * Centralised PrismaClient factory.
 *
 * Why this exists:
 * - Prisma 7 made driver-adapters mandatory. The runtime no longer reads the
 *   connection string from the schema's `datasource` block; we have to build
 *   a `pg`-backed adapter and pass it to `new PrismaClient({ adapter })`.
 * - All call sites in the server used to do `new PrismaClient()` directly.
 *   Wiring the adapter at every call site would scatter the connection
 *   logic and make future changes (pool tuning, telemetry, alternate
 *   drivers) painful. This factory keeps the adapter construction in one
 *   place.
 *
 * Why a factory, not a singleton:
 * - The existing call-site pattern in this codebase creates a fresh
 *   PrismaClient where it's needed (some lifecycle handlers re-use a
 *   pre-injected client; others build their own per-task). Switching to a
 *   shared singleton is a separate refactor that we are not doing as part
 *   of the Prisma 7 bump. `createPrismaClient()` is a drop-in replacement
 *   for `new PrismaClient()` that returns an independent client + adapter
 *   pair, preserving the previous semantics.
 *
 * The connection string is read from `process.env.DATABASE_URL` at the
 * moment the client is constructed. The string is not cached or reused: if
 * it is unset, `pg` will throw on the first query, which is the correct
 * fail-loud behaviour.
 */
export function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
