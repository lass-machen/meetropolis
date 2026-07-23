import type { PrismaClient } from '../generated/prisma/index.js';
import { type PackScope, avatarPackScopeWhere, customAvatarScopeWhere } from './packScope.js';

// The six built-in default avatars (shipped PNGs under
// apps/web/public/assets/sprites). They are NOT stored as an AvatarPack row —
// the client synthesises the `default-characters:*` ids (avatarRegistry
// .ensureDefault) — so they are allow-listed here. Keep in sync with
// tools/sprite-generator/generate.py DEFAULTS.
const DEFAULT_PACK = 'default-characters';
const DEFAULT_AVATAR_KEYS: ReadonlySet<string> = new Set([
  'business_man',
  'business_woman',
  'casual_woman',
  'dev_hoodie',
  'manager_woman',
  'suit_man',
]);
const CUSTOM_PREFIX = 'custom:';

/**
 * Whether `avatarId` names a user-composed custom avatar (`custom:<uuid>`).
 *
 * Exported because several call sites have to apply the SAME rule to NPCs and
 * drifted apart before: the realtime handler (rooms/handlers/avatarHandler.ts)
 * refused custom ids for NPCs while the REST surface (api/routes/npcs.ts)
 * happily persisted them and the join path (rooms/lifecycle/onJoin.completion
 * .ts) put them into the room state. One predicate, one rule.
 */
export function isCustomAvatarId(avatarId: string): boolean {
  return avatarId.startsWith(CUSTOM_PREFIX);
}

/**
 * Whether `avatarId` refers to something that actually exists and is wearable
 * BY THIS CALLER:
 *   - a built-in `default-characters:*` avatar (always — they ship with the
 *     platform and are not backed by an AvatarPack row at all),
 *   - an avatar from an AvatarPack the caller's `scope` covers: every catalog
 *     pack, plus the private packs of the tenant the caller has proven a
 *     binding to (see services/packScope.ts), or
 *   - an EXISTING `custom:<uuid>` custom avatar OF THE CALLER'S OWN, PROVEN
 *     TENANT.
 *
 * The `scope` argument is what turns a private pack's ownership into a hard
 * veto instead of a listing preference. Without it this check accepted an
 * avatar out of ANY registered pack, so a user of a foreign tenant could not
 * SEE the internal pack yet could still `PATCH /me/avatar` one of its ids — the
 * value was persisted and broadcast to the room. Listing and wearing now
 * resolve through the same scope, so the two cannot drift apart again.
 *
 * The SAME scope now governs the custom branch. It previously ran an unfiltered
 * `findUnique({ uuid })` on the stated grounds that custom-avatar visibility was
 * global anyway. That premise is gone: `POST /avatars/resolve` is tenant-scoped
 * (api/routes/meAvatar.ts `handleResolve`), so leaving this branch global would
 * (a) contradict the endpoint and (b) leave a plain existence oracle — a
 * foreign tenant's user could probe uuids one at a time and read tenant
 * membership off the accept/reject of `PATCH /me/avatar`. Wearing and resolving
 * therefore share one rule, exactly as listing and wearing already do for packs.
 *
 * Consequence worth naming: an avatar composed under tenant A is not wearable
 * while acting in tenant B, and a legacy row with a NULL `tenantId` is not
 * wearable at all (see `customAvatarScopeWhere`). Both heal by re-saving in the
 * editor, which re-stamps the caller's proven tenant; a changed appearance also
 * issues a fresh uuid. The one case that cannot heal is a session carrying no
 * proven tenant at all — `POST /me/avatar/compose` answers 403 there — but such
 * a caller only ever holds catalog scope anyway, so nothing of theirs was
 * wearable to begin with.
 *
 * What this still rejects, unchanged, is a free-form / non-existent id: the
 * original handlers persisted and broadcast any arbitrary string, which broke
 * rendering and let a client claim an id that resolves to nothing.
 */
export async function isAllowedAvatarId(prisma: PrismaClient, avatarId: string, scope: PackScope): Promise<boolean> {
  if (isCustomAvatarId(avatarId)) {
    const uuid = avatarId.slice(CUSTOM_PREFIX.length);
    if (!uuid) return false;
    const where = customAvatarScopeWhere(scope);
    // Nothing proven -> no custom avatar is reachable at all.
    if (where === null) return false;
    // findFirst, not findUnique: the tenant filter is part of the lookup, so an
    // out-of-scope row never resolves — same posture as the pack branch below.
    const found = await prisma.customAvatar.findFirst({ where: { uuid, ...where }, select: { uuid: true } });
    return found !== null;
  }
  const sep = avatarId.indexOf(':');
  if (sep <= 0 || sep === avatarId.length - 1) return false;
  const packUuid = avatarId.slice(0, sep);
  const key = avatarId.slice(sep + 1);
  if (packUuid === DEFAULT_PACK) return DEFAULT_AVATAR_KEYS.has(key);
  // findFirst, not findUnique: the scope filter is part of the lookup, so an
  // out-of-scope private pack never resolves in the first place — the same
  // posture GET /avatar-packs/:id uses.
  const pack = await prisma.avatarPack.findFirst({
    where: { uuid: packUuid, ...avatarPackScopeWhere(scope) },
    select: { avatars: true },
  });
  if (!pack) return false;
  const avatars = Array.isArray(pack.avatars) ? pack.avatars : [];
  return avatars.some(
    (entry) => entry !== null && typeof entry === 'object' && (entry as { key?: unknown }).key === key,
  );
}
