import type { Prisma } from '../generated/prisma/index.js';
import { avatarPackScopeWhere, resolvePublicPackScope, type PackScope } from './packScope.js';

export const BASE_AVATAR_PACK_UUID = 'default-characters';
export const BASE_AVATAR_KEY = 'business_man';

type PublicScopeResolver = (prisma: Prisma.TransactionClient, packKind: 'avatar') => Promise<PackScope>;

function hasAvatarKey(avatars: unknown): boolean {
  if (!Array.isArray(avatars)) return false;
  return avatars.some(
    (avatar) => avatar !== null && typeof avatar === 'object' && (avatar as { key?: unknown }).key === BASE_AVATAR_KEY,
  );
}

/** Refuse to serve a deployment in which no world join can obtain its fallback avatar. */
export async function assertBaseAvatarAvailable(
  prisma: Prisma.TransactionClient,
  resolveScope: PublicScopeResolver = resolvePublicPackScope,
): Promise<void> {
  const scope = await resolveScope(prisma, 'avatar');
  const pack = await prisma.avatarPack.findFirst({
    where: { uuid: BASE_AVATAR_PACK_UUID, ...avatarPackScopeWhere(scope) },
    select: { avatars: true },
  });
  if (pack && hasAvatarKey(pack.avatars)) return;

  throw new Error(
    `Startup blocked: required base avatar '${BASE_AVATAR_PACK_UUID}:${BASE_AVATAR_KEY}' is missing or unavailable ` +
      'in the public avatar scope. Run "npx prisma db seed --schema=apps/server/prisma/schema.prisma" successfully ' +
      'before starting the server, then verify the tenancy catalogue does not block the base pack.',
  );
}

/** Sequence startup checks before the operation that opens the listening socket. */
export async function listenAfterStartupChecks(
  check: () => Promise<void>,
  listen: () => Promise<unknown>,
): Promise<void> {
  await check();
  await listen();
}
