/**
 * The blueprint tenant every new tenant's starter map is copied from.
 *
 * ONE resolver for both sides of the contract — the seed that BOOTSTRAPS the
 * tenant (prisma/seed.ts) and the signup that READS it
 * (api.ts `copyTemplateMapsForSignup`). They used to disagree: the seed fell
 * back to `'template'` while signup bailed out when the variable was unset, so
 * an installation without `TEMPLATE_TENANT_SLUG` grew a fully seeded template
 * tenant that nothing ever used and handed its customers no map at all — with
 * no log line to explain it, because signup returned before the "not found"
 * branch.
 *
 * The fallback is a DEDICATED slug on purpose. Pointing this at a workspace
 * people actually use (`default`, say) means every signup inherits that
 * workspace's drafts, scratch maps and clutter — the bug this whole cutover
 * exists to fix.
 *
 * Deliberately read per call, not cached: the seed and the server are separate
 * processes with separate environments, and tests set the variable per case.
 */
export const DEFAULT_TEMPLATE_TENANT_SLUG = 'template';

export function resolveTemplateTenantSlug(): string {
  const fromEnv = process.env.TEMPLATE_TENANT_SLUG;
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_TEMPLATE_TENANT_SLUG;
}
