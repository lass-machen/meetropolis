import { AccessToken } from 'livekit-server-sdk';
import type { AccessTokenOptions } from 'livekit-server-sdk';

/**
 * Lifetime of a LiveKit access token. The SDK default is 6 h, and LiveKit
 * cannot revoke an issued token, so a user who lost access could rejoin a call
 * with a cached token for that long. Connected participants keep working past
 * the lifetime because the LiveKit server hands them refreshed tokens.
 * Override with LIVEKIT_TOKEN_TTL_SECONDS (60 to 86400).
 */
export const DEFAULT_LIVEKIT_TOKEN_TTL_SECONDS = 15 * 60;

export function livekitTokenTtlSeconds(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.LIVEKIT_TOKEN_TTL_SECONDS);
  if (!Number.isInteger(raw) || raw < 60 || raw > 86_400) return DEFAULT_LIVEKIT_TOKEN_TTL_SECONDS;
  return raw;
}

/**
 * Token lifetime for a member whose access ends at `expiresAt` (guests): never
 * past the end of the access, otherwise the regular lifetime.
 */
export function tokenTtlForAccess(expiresAt: Date | null, now: Date = new Date()): number {
  const regular = livekitTokenTtlSeconds();
  if (!expiresAt) return regular;
  const remaining = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  return Math.max(1, Math.min(regular, remaining));
}

export async function createLivekitToken(params: {
  roomName: string;
  identity: string;
  /** End of the member's tenant access (guests); the token never outlives it. */
  accessExpiresAt?: Date | null;
  name?: string;
  /** Participant metadata, e.g. the opaque session reference of the issuer. */
  metadata?: string;
  canPublish?: boolean;
  canPublishData?: boolean;
  canSubscribe?: boolean;
}) {
  const apiKey = process.env.LIVEKIT_API_KEY!;
  const apiSecret = process.env.LIVEKIT_API_SECRET!;
  const opts: AccessTokenOptions = {
    identity: params.identity,
    ttl: tokenTtlForAccess(params.accessExpiresAt ?? null),
  };
  if (typeof params.name === 'string') opts.name = params.name;
  if (typeof params.metadata === 'string') opts.metadata = params.metadata;
  const at = new AccessToken(apiKey, apiSecret, opts);
  at.addGrant({
    room: params.roomName,
    roomJoin: true,
    canPublish: params.canPublish ?? true,
    canPublishData: params.canPublishData ?? true,
    canSubscribe: params.canSubscribe ?? true,
    // No canUpdateOwnMetadata grant: the session reference in the metadata is
    // written by the server and read back by the access reconciliation, so a
    // participant must never be able to rewrite it (absent means denied).
  });
  const jwt = await at.toJwt();
  return jwt;
}
