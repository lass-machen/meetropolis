import crypto from 'crypto';
import { getJwtSecret } from '../../api/utils/authHelpers.js';

/**
 * Opaque binding between a LiveKit participant and the login session that
 * issued its token.
 *
 * A participant on the SFU is addressed by an identity alone, so a token that
 * stays valid after the session behind it ended would let its holder rejoin
 * with a cached token. The token therefore carries a reference that only the
 * server can resolve back to a session: an HMAC over the session row id under
 * a key derived from the JWT secret with its own purpose label. The
 * reference proves "this participant holds the session it was issued for"
 * without exposing the session id, the token or the token hash to the SFU or
 * to any other participant.
 */

/** Version prefix of the reference; a change of the derivation needs a new one. */
const SESSION_REF_VERSION = 'v1';

/** Purpose label of the key derivation; never reuse it for another purpose. */
const SESSION_REF_KEY_INFO = 'meetropolis/av-session-ref/v1';

/** Length of the derived key in bytes. */
const SESSION_REF_KEY_LENGTH = 32;

/** Length of the base64url encoded digest of a 32 byte HMAC, without padding. */
const SESSION_REF_LENGTH = 43;

const SESSION_REF_PATTERN = new RegExp(`^${SESSION_REF_VERSION}\\.[A-Za-z0-9_-]{${SESSION_REF_LENGTH}}$`);

/**
 * Identities reserved for services and for the readiness probe. The user
 * endpoint never issues them, so such an identity always belongs to a
 * service, never to a member.
 */
const RESERVED_IDENTITY_PREFIXES = ['npc-', 'svc-'];

/** Identity of the readiness probe participant (see the health route). */
const RESERVED_PROBE_IDENTITY = 'probe';

let cachedKey: Buffer | null = null;

/** Derive the reference key once per process. */
function sessionRefKey(): Buffer {
  if (cachedKey) return cachedKey;
  const derived = crypto.hkdfSync(
    'sha256',
    getJwtSecret(),
    Buffer.alloc(0),
    SESSION_REF_KEY_INFO,
    SESSION_REF_KEY_LENGTH,
  );
  cachedKey = Buffer.from(derived);
  return cachedKey;
}

/** Opaque, versioned reference of one login session. */
export function avSessionRef(sessionId: string): string {
  const digest = crypto.createHmac('sha256', sessionRefKey()).update(sessionId).digest('base64url');
  return `${SESSION_REF_VERSION}.${digest}`;
}

/**
 * Metadata written into the LiveKit token. It carries the reference and
 * nothing else - no session id, no token, no token hash.
 */
export function avSessionMetadata(sessionId: string): string {
  return JSON.stringify({ sessionRef: avSessionRef(sessionId) });
}

/**
 * Read the session reference out of participant metadata.
 *
 * Returns null for missing, malformed or foreign metadata: only a reference
 * of the current version and of the expected fixed length is accepted.
 */
export function readAvSessionRef(metadata: string | undefined): string | null {
  if (typeof metadata !== 'string' || metadata.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const ref = (parsed as Record<string, unknown>).sessionRef;
  if (typeof ref !== 'string' || !SESSION_REF_PATTERN.test(ref)) return null;
  return ref;
}

/** Constant-time check that a reference belongs to the given session. */
export function avSessionRefMatches(ref: string, sessionId: string): boolean {
  const expected = Buffer.from(avSessionRef(sessionId), 'utf8');
  const presented = Buffer.from(ref, 'utf8');
  if (presented.length !== expected.length) return false;
  return crypto.timingSafeEqual(presented, expected);
}

/** True for the identities the user endpoint must never issue. */
export function isReservedAvIdentity(identity: string): boolean {
  if (identity === RESERVED_PROBE_IDENTITY) return true;
  return RESERVED_IDENTITY_PREFIXES.some((prefix) => identity.startsWith(prefix));
}
