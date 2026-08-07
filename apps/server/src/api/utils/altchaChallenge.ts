import { CappedMap, createChallenge, randomInt, verifySolution } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import type { Challenge, Payload } from 'altcha-lib/types';
import { logger } from '../../logger.js';

/**
 * ALTCHA proof-of-work challenges for unauthenticated public forms.
 *
 * The client is handed a challenge, spends a measurable amount of CPU solving
 * it and returns the solution with the form. That does not identify humans —
 * it prices bulk submission. A spammer who wants a thousand messages has to
 * pay a thousand times the compute, which is what makes drive-by form spam
 * uneconomical. It is deliberately one layer among several (honeypot, minimum
 * fill time, per-IP and per-address rate limits); on its own a determined
 * attacker with a GPU beats PBKDF2 by orders of magnitude, and nothing here
 * pretends otherwise.
 *
 * Chosen over a hosted captcha because it involves no third party: no request
 * leaves the visitor's browser for anyone but us, which keeps the contact page
 * consistent with the data-protection claims the same site makes.
 *
 * Statelessness: the challenge carries its own parameters, its issue time and
 * an expiry, all covered by an HMAC signature over the parameter set. The
 * server therefore stores nothing to *issue* one. It does keep a small record
 * of already-redeemed challenges, because a signature proves authenticity, not
 * freshness — see `markChallengeRedeemed`.
 */

/** How long a freshly issued challenge stays solvable. */
const CHALLENGE_TTL_MS = 30 * 60_000;

/**
 * PBKDF2 iterations per counter attempt. Together with {@link MAX_COUNTER}
 * this sets the price of one submission: the solver tries counters until the
 * derived key matches the published prefix, so the expected work is
 * `MAX_COUNTER / 2` derivations.
 *
 * Measured against the WebCrypto implementation the browser actually runs:
 * ~0.42 ms per attempt on an Apple-Silicon laptop, so ~0.4 s expected on fast
 * hardware and roughly 1-2 s on a low-end phone. The web client starts solving
 * as soon as the visitor touches the form, so that cost is normally spent
 * while they are still typing rather than after they press send.
 */
const DEFAULT_COST = 5_000;

/** Upper bound of the counter the solver has to find. */
const DEFAULT_MAX_COUNTER = 2_000;

/**
 * Redeemed-challenge memory for replay protection.
 *
 * Without it the signature check alone would accept the same solved payload
 * forever: a spammer solves one challenge and replays that single proof for
 * every message, which defeats the entire point of charging per submission.
 * Keyed by the challenge nonce, which is 16 random bytes per issue.
 *
 * Capped rather than unbounded so a flood of solved challenges cannot grow the
 * heap without limit. The cap is the trade-off that comes with it: past 20k
 * live entries the oldest are evicted and could in principle be replayed,
 * which is far beyond any legitimate contact-form volume and still bounded by
 * the rate limiters in front of the route. Entries are also dropped once their
 * challenge has expired, so the map stays near-empty in normal operation.
 *
 * Per process, like the rate limiters: correct for the current single-instance
 * deployment, and something to move into a shared store if the server is ever
 * scaled horizontally.
 */
const redeemedChallenges = new CappedMap<string, number>({ maxSize: 20_000 });

export type ChallengeRejection =
  'not_configured' | 'malformed' | 'expired' | 'invalid_signature' | 'invalid_solution' | 'replayed' | 'too_fast';

export interface ChallengeVerificationResult {
  ok: boolean;
  /** Set when `ok` is false; names which check failed, for logging. */
  reason?: ChallengeRejection;
}

/**
 * The HMAC secret that signs challenges. Absent secret means the whole
 * challenge mechanism is unconfigured, which callers must treat as "this
 * endpoint is not available" rather than "let it through" — a form protected
 * by an unconfigured guard is an open relay.
 */
function readHmacSecret(): string | null {
  const raw = (process.env.ALTCHA_HMAC_KEY ?? '').trim();
  return raw.length > 0 ? raw : null;
}

function readPositiveIntEnv(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    logger.warn({ event: 'altcha.invalid_env', envKey, value: raw, fallback });
    return fallback;
  }
  return parsed;
}

/** True when `ALTCHA_HMAC_KEY` is set and challenges can be issued/verified. */
export function isChallengeConfigured(): boolean {
  return readHmacSecret() !== null;
}

/**
 * Issue a signed challenge. Returns null when unconfigured.
 *
 * `data.issuedAt` rides along inside the signed parameter set, which is what
 * makes the minimum-fill-time check tamper-proof: a bot cannot backdate it
 * without breaking the signature.
 */
export async function issueChallenge(): Promise<Challenge | null> {
  const hmacSecret = readHmacSecret();
  if (!hmacSecret) return null;

  const cost = readPositiveIntEnv('ALTCHA_COST', DEFAULT_COST);
  const maxCounter = readPositiveIntEnv('ALTCHA_MAX_COUNTER', DEFAULT_MAX_COUNTER);

  return createChallenge({
    algorithm: 'PBKDF2/SHA-256',
    cost,
    deriveKey,
    // Picking the counter up front is what lets the server publish a key
    // prefix and verify the answer by HMAC alone later, instead of re-running
    // the derivation chain on every submission.
    counter: randomInt(maxCounter, 0),
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    hmacSignatureSecret: hmacSecret,
    // Signing the derived key gives verification a constant-cost path: an
    // attacker cannot make us burn PBKDF2 cycles by posting junk solutions.
    hmacKeySignatureSecret: hmacSecret,
    data: { issuedAt: Date.now() },
  });
}

/** Narrow an unknown JSON value to an ALTCHA payload without trusting it. */
function parsePayload(raw: unknown): Payload | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { challenge?: unknown; solution?: unknown };
  const challenge = candidate.challenge as Challenge | undefined;
  const solution = candidate.solution as Payload['solution'] | undefined;
  if (!challenge || typeof challenge !== 'object') return null;
  if (!challenge.parameters || typeof challenge.parameters !== 'object') return null;
  if (typeof challenge.parameters.nonce !== 'string') return null;
  if (!solution || typeof solution !== 'object') return null;
  if (typeof solution.counter !== 'number' || typeof solution.derivedKey !== 'string') return null;
  return { challenge, solution };
}

/** Drop expired nonces so the replay map does not accumulate dead entries. */
function pruneRedeemed(now: number): void {
  for (const [nonce, expiresAtMs] of redeemedChallenges) {
    if (expiresAtMs <= now) redeemedChallenges.delete(nonce);
  }
}

/**
 * Record a nonce as spent. Returns false when it was already spent, which is
 * the replay case.
 */
function markChallengeRedeemed(nonce: string, expiresAtSeconds: number | undefined, now: number): boolean {
  if (redeemedChallenges.has(nonce)) return false;
  pruneRedeemed(now);
  const expiresAtMs = expiresAtSeconds !== undefined ? expiresAtSeconds * 1_000 : now + CHALLENGE_TTL_MS;
  redeemedChallenges.set(nonce, expiresAtMs);
  return true;
}

/**
 * Read the signed issue timestamp. Returns null when the challenge carries
 * none, in which case the minimum-fill-time check is skipped rather than
 * failing closed — an unsigned-but-otherwise-valid challenge cannot occur
 * through `issueChallenge`, and inventing a timestamp would be worse.
 */
function readIssuedAt(challenge: Challenge): number | null {
  const issuedAt = challenge.parameters.data?.issuedAt;
  return typeof issuedAt === 'number' && Number.isFinite(issuedAt) ? issuedAt : null;
}

/**
 * Verify a solved challenge and consume it.
 *
 * Order matters: everything cheap and stateless runs before the nonce is
 * marked spent, so a malformed or forged payload cannot burn a legitimate
 * visitor's challenge.
 *
 * @param raw the parsed JSON payload as submitted by the client
 * @param minFillMs reject submissions that arrive sooner than this after the
 *   challenge was issued. A person needs seconds to write a message; a script
 *   that fetches, solves and posts in one go does not.
 */
export async function verifyChallenge(raw: unknown, minFillMs: number): Promise<ChallengeVerificationResult> {
  const hmacSecret = readHmacSecret();
  if (!hmacSecret) return { ok: false, reason: 'not_configured' };

  const payload = parsePayload(raw);
  if (!payload) return { ok: false, reason: 'malformed' };

  const result = await verifySolution({
    challenge: payload.challenge,
    solution: payload.solution,
    deriveKey,
    hmacSignatureSecret: hmacSecret,
    hmacKeySignatureSecret: hmacSecret,
  });

  if (result.expired) return { ok: false, reason: 'expired' };
  if (result.invalidSignature) return { ok: false, reason: 'invalid_signature' };
  if (!result.verified) return { ok: false, reason: 'invalid_solution' };

  const now = Date.now();
  const issuedAt = readIssuedAt(payload.challenge);
  if (issuedAt !== null && now - issuedAt < minFillMs) {
    return { ok: false, reason: 'too_fast' };
  }

  if (!markChallengeRedeemed(payload.challenge.parameters.nonce, payload.challenge.parameters.expiresAt, now)) {
    return { ok: false, reason: 'replayed' };
  }

  return { ok: true };
}

/** Test helper: forget every redeemed nonce so cases do not leak into each other. */
export function __resetRedeemedChallengesForTesting(): void {
  redeemedChallenges.clear();
}
