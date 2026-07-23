import type express from 'express';

/**
 * Per-request auth resolution, produced by the session-auth middleware
 * (`sessionAuth.ts`) and consumed by `requireAuth` (`authHelpers.ts`).
 *
 * This tiny module exists purely to break the import cycle between those two:
 * `authHelpers` must read the resolution, `sessionAuth` must write it, and
 * `sessionAuth` needs `authHelpers` for JWT/cookie primitives.
 *
 * The resolution is kept in a `WeakMap` keyed by the Express request object
 * rather than as a request property. That keeps the state strongly typed
 * without augmenting the global `express-serve-static-core` Request interface
 * and without an `any` cast at the read site (see AGENTS.md "no any"), and it
 * drops out of memory with the request itself.
 */

/** Identity carried by a request whose token maps to a live session row. */
export interface ResolvedAuth {
  userId: string;
  tenantId?: string;
  /** Id of the backing `Session` row — the authority for this request. */
  sessionId: string;
  /** SHA-256 of the presented token; the `Session.tokenHash` that matched. */
  tokenHash: string;
}

/**
 * Result of running the session-auth middleware for one request.
 * `auth === null` means "middleware ran, token absent/invalid/revoked" and is
 * deliberately distinct from "middleware never ran" (no entry at all), which
 * `requireAuth` treats as a wiring bug and fails closed on.
 */
export interface AuthResolution {
  auth: ResolvedAuth | null;
}

const resolutions = new WeakMap<express.Request, AuthResolution>();

export function setAuthResolution(req: express.Request, resolution: AuthResolution): void {
  resolutions.set(req, resolution);
}

export function getAuthResolution(req: express.Request): AuthResolution | undefined {
  return resolutions.get(req);
}
