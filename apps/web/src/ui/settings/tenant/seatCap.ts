/**
 * How many participants a tenant may have in the world at the same time.
 *
 * This mirrors the server's admission rule and must not drift from it. The
 * server admits a join while `active < max(concurrentLimit, freeSeats)`
 * (apps/server/src/rooms/lifecycle/onJoin.limiter.ts) — the two numbers are
 * alternatives, not addends:
 *
 *   - `freeSeats`  — the baseline every tenant keeps without paying
 *                    (server default from DEFAULT_FREE_SEATS).
 *   - `concurrentLimit` — the cap the booked tier grants.
 *
 * A paid tier RAISES the cap to its own limit; it does not stack on top of the
 * free baseline. Summing them (the previous behaviour) advertised 8 where the
 * server admits 5, which is why the organisation dialog and the subscription
 * dialog disagreed.
 *
 * Note this is a concurrency cap, not a headcount: a workspace may have any
 * number of members: it just cannot have more than this many of them online at
 * once.
 */
export function effectiveSeatCap(tenant: { concurrentLimit: number; freeSeats: number }): number {
  return Math.max(tenant.concurrentLimit, tenant.freeSeats);
}
