import crypto from 'crypto';
import type { PrismaClient } from '../../generated/prisma/index.js';

/**
 * Rejected stand-ins for `NPC_SERVICE_SECRET`: the literal used when the
 * variable is unset. Compared after trim, in every environment.
 */
const KNOWN_NPC_SERVICE_SECRET_DEFAULTS = ['dev-npc-secret'] as const;

const MIN_NPC_SERVICE_SECRET_LENGTH = 32;

/** Join identities are this prefix plus the stored `Npc.identity`. */
const NPC_JOIN_PREFIX = 'npc-';

/**
 * A secret is usable only when it is present, not blank, not a known default,
 * and at least 32 characters after trim. The value itself is never returned.
 */
export function isSecureNpcServiceSecret(value: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < MIN_NPC_SERVICE_SECRET_LENGTH) return false;
  return !KNOWN_NPC_SERVICE_SECRET_DEFAULTS.some((known) => known === trimmed);
}

/**
 * True only when the server secret is usable and `presented` is a string of
 * the same byte length that matches it. Length is checked before the compare
 * because `timingSafeEqual` rejects unequal buffers.
 */
export function verifyNpcServiceToken(presented: unknown): boolean {
  const secret = process.env.NPC_SERVICE_SECRET;
  if (!isSecureNpcServiceSecret(secret) || typeof secret !== 'string') return false;
  if (typeof presented !== 'string') return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(presented);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * The NPC service joins as `npc-` plus `Npc.identity` (one prefix, the value
 * stored for that tenant). `@@unique([tenantId, identity])` makes the row
 * unique. Returns null when the prefix or the row is missing.
 */
export async function resolveNpcPrincipal(
  prisma: PrismaClient,
  tenantId: string,
  joinIdentity: string,
): Promise<{ npcId: string; identity: string } | null> {
  if (!joinIdentity.startsWith(NPC_JOIN_PREFIX)) return null;
  const identity = joinIdentity.slice(NPC_JOIN_PREFIX.length);
  if (identity.length === 0) return null;
  const row = await prisma.npc.findUnique({
    where: { tenantId_identity: { tenantId, identity } },
    select: { id: true, identity: true },
  });
  if (!row) return null;
  return { npcId: row.id, identity: row.identity };
}
