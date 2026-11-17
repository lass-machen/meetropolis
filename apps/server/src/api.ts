import type express from 'express';
import type { PrismaClient } from './generated/prisma/index.js';
import { createPrismaClient } from './db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Route modules
import { registerAuthRoutes } from './api/routes/auth.js';
import { registerMapRoutes } from './api/routes/maps.js';
import { registerAssetPackRoutes } from './api/routes/assetPacks.js';
import { registerAvatarPackRoutes } from './api/routes/avatarPacks.js';
import { registerAdminRoutes } from './api/routes/admin.js';
import { registerHealthRoutes } from './api/routes/health.js';
import { registerMiscRoutes } from './api/routes/misc.js';
import { registerTmjRoutes } from './api/routes/tmj.js';
import { registerMapObjectRoutes } from './api/routes/mapObjects.js';
import { registerNpcRoutes } from './api/routes/npcs.js';
import { registerNpcMediaRoutes } from './api/routes/npcMedia.js';
import { registerAdminMapRoutes } from './api/routes/adminMaps.js';
import { registerAdminPasswordResetRoutes } from './api/routes/admin.passwordReset.js';
import { registerAdminAccountConfirmationRoutes } from './api/routes/admin.accountConfirmation.js';
import { copyMapToTenant } from './api/routes/adminMaps.js';
import { registerGuestRoutes } from './api/routes/guests.js';
import { deleteTenantWithMembers, removeMemberFromTenant } from './services/accountDeletion.js';
import { registerTenantRoutes } from './api/routes/tenant.js';
import { registerContactRoutes } from './api/routes/contact.js';
import { registerMobileRoutes } from './mobile/routes.js';
import { guestExpiryMiddleware } from './api/middleware/guestExpiry.js';
import { tenantSignupRateLimiter } from './api/middleware/rateLimit.js';

// Existing modular routes (already extracted)
import { registerApiTokenRoutes } from './api/routes/tokens.js';
import { registerPresenceRoutes } from './api/routes/presence.js';
import { registerUserRoutes } from './api/routes/users.js';
import { registerControlRoutes } from './api/routes/controls.js';
import { registerMeAvatarRoutes } from './api/routes/meAvatar.js';

// Auth utilities for existing modular routes
import {
  requireAuth,
  requireApiToken,
  getApiTokenPepper,
  requireSuperAdmin,
  getTenantFromReq,
  requireMembership,
  getUserIdFromReq,
  computeOnlineUsageByTenantSlug,
  getJwtSecret,
  setAuthCookie,
  normalizeEmailForStorage,
  createRequireTenantAdmin,
} from './api/utils/authHelpers.js';
import { createSessionAuthMiddleware, establishSession } from './api/utils/sessionAuth.js';
import { recordAuthEvent } from './services/authEvents.js';
import { createTenantAccessMiddleware } from './api/middleware/tenantAccess.js';
import { startEmailVerification } from './api/routes/auth.verify.js';
import { isNativeClientRequest } from './api/routes/auth.helpers.js';
import { buildPublicWebLink, publicWebBase } from './api/utils/publicLinks.js';

// Enterprise module loaders
import { assertTenantDeletionProtocol, getAdminEnterpriseModule } from './adminLoader.js';
import { createJournalPlanResolver } from './services/tenantDeletionPlanning.js';
import { createSharedPlanResolver } from './services/sharedPlanResolver.js';
import { createAccountJournalPlanResolver, registerAccountDeletionJournal } from './services/accountDeletionJournal.js';
import { isTenantSlugReserved } from './services/tenantSlugReservation.js';
import { getBillingModule } from './billingLoader.js';
import { getTenancyModule } from './tenancyLoader.js';
import { getTelemetryModule } from './telemetryLoader.js';
import { getTranscriptionModule } from './transcriptionLoader.js';
import { logger } from './logger.js';
import { getEmailModule, sendIfAvailable } from './emailLoader.js';
import { createBillingEmailService } from './billingEmailService.js';
import { deliveringEmailModule } from './api/utils/emailProof.js';
import { resolveTenantBySlug } from './tenancy.js';
import { resolveTemplateTenantSlug } from './services/templateTenant.js';
import { createMemberAssetRouter, MEMBER_ASSETS_PREFIX } from './ops/memberAssetRoutes.js';

const prisma = createPrismaClient();

// File-backed deletion journal: one plan resolver per process, shared by the
// admin routes and the scheduled tenant deletion. It is created lazily on first
// use (route setup never touches the database or the filesystem for it) and
// created again after a failed attempt. Creation reconciles undecided intents,
// so no second resolver may exist in the process; see createSharedPlanResolver.
// The journal directory is trimmed here, the one place both callers pass.
const sharedPlanResolverForDir = createSharedPlanResolver(
  (journalDir: string) =>
    createJournalPlanResolver({ prisma, journalDir, retentionDays: process.env.BACKUP_RETENTION_DAYS }),
  (error) => logger.warn({ event: 'tenant_delete.journal_resolver_unavailable', error: String(error) }),
);
const sharedJournalPlanResolver = (journalDir: string) => sharedPlanResolverForDir(journalDir.trim());
type JournalPlanResolver = NonNullable<Awaited<ReturnType<typeof sharedJournalPlanResolver>>>;

/** Plan resolver for the admin routes; undefined without a journal directory. */
function tenantDeletionPlanResolver(journalDir: string | undefined) {
  if (journalDir === undefined || journalDir.trim() === '') return undefined;
  return async (tx: Parameters<JournalPlanResolver>[0], input: Parameters<JournalPlanResolver>[1]) => {
    const resolver = await sharedJournalPlanResolver(journalDir);
    return resolver === undefined ? undefined : resolver(tx, input);
  };
}

/**
 * Registers the file-backed account deletion journal from the environment. The directory and
 * the retention are read and trimmed exactly like the tenant plan resolver above. Without a
 * directory nothing is registered.
 */
function registerAccountJournalFromEnv() {
  const journalDir = process.env.DELETION_JOURNAL_DIR?.trim();
  registerAccountDeletionJournal(
    journalDir
      ? createAccountJournalPlanResolver({ prisma, journalDir, retentionDays: process.env.BACKUP_RETENTION_DAYS })
      : undefined,
  );
}

/** Dependencies of the scheduled tenant deletion in the hourly billing pass. */
function scheduledTenantDeletionDeps() {
  return {
    journalDir: process.env.DELETION_JOURNAL_DIR || undefined,
    deleteTenantWithMembers: (tenantId: string, options?: Parameters<typeof deleteTenantWithMembers>[2]) => {
      assertTenantDeletionProtocol(options?.deletionProtocol);
      return deleteTenantWithMembers(prisma, tenantId, options);
    },
    createPlanResolver: (journalDir: string) => sharedJournalPlanResolver(journalDir),
  };
}

/** The shared API client used by startup invariants before the server listens. */
export function getApiPrismaClient(): PrismaClient {
  return prisma;
}

// Tenant-admin guard injected into the enterprise billing routes via the loader
// config. It verifies the caller holds an owner/admin membership in the resolved
// tenant (or is a platform super-admin), so a spoofed X-Tenant header cannot
// reach a foreign tenant's /billing/* routes (M2/M4). See authHelpers.ts.
const requireTenantAdminMiddleware = createRequireTenantAdmin(prisma);

function tenantContextFromReq(req: express.Request) {
  const t = req.tenant;
  if (t && t.id && t.slug) {
    return { id: t.id, slug: t.slug, bypassLimits: !!t.bypassLimits, isInternal: !!t.isInternal };
  }
  return null;
}

/**
 * Give a freshly signed-up tenant its starting world: EXACTLY ONE map, copied
 * from the template tenant.
 *
 * Which map — and why `defaultMapName` rather than "all of them" or "the first
 * one":
 *
 * - The template tenant is a real, editable workspace. The operator maintains
 *   the starter map there in the map editor and may keep drafts, archived
 *   variants or scratch maps next to it. Copying every map hands each new
 *   customer that internal clutter, which is exactly what happened while the
 *   internal workspace doubled as the template tenant.
 * - `defaultMapName` is the only non-arbitrary selector available: it is the
 *   map the template tenant itself boots into, so by construction it is the one
 *   the operator considers "the" starter map. It is also the value the new
 *   tenant needs anyway (see the update below), so no second source of truth.
 * - Deliberately NO "just take the first map" fallback. `maps` comes back in an
 *   unspecified order, so that fallback would silently change which map a
 *   customer receives the moment the operator adds a draft. A missing starter
 *   map is loud, visible in the logs and repairable; a wrong starter map is
 *   silent and, once the customer starts editing it, permanent.
 *
 * Never throws. The enterprise signup calls this as a best-effort step through
 * the admin loader contract (`copyTemplateMaps`), and a failed map copy must
 * not abort an otherwise successful sign-up.
 *
 * The slug comes from the SAME resolver the seed uses
 * (services/templateTenant.ts), so the tenant that gets bootstrapped and the
 * tenant that gets read can never diverge. A silent `return` on an unset
 * variable is what made that divergence invisible before.
 */
export async function copyTemplateMapsForSignup(prismaClient: PrismaClient, tenantId: string): Promise<void> {
  const templateSlug = resolveTemplateTenantSlug();
  try {
    const templateTenant = await prismaClient.tenant.findUnique({
      where: { slug: templateSlug },
      include: { maps: true },
    });
    if (!templateTenant) {
      logger.error({ event: 'signup.template_tenant_not_found', tenantId, templateSlug });
      return;
    }
    const defaultMapName = templateTenant.defaultMapName;
    if (!defaultMapName) {
      logger.error({ event: 'signup.template_default_map_missing', tenantId, templateSlug });
      return;
    }
    const templateMap = templateTenant.maps.find((m) => m.name === defaultMapName);
    if (!templateMap) {
      logger.error({
        event: 'signup.template_map_not_found',
        tenantId,
        templateSlug,
        defaultMapName,
        templateMapCount: templateTenant.maps.length,
      });
      return;
    }
    const copied = await copyMapToTenant(prismaClient, templateMap.id, tenantId, templateMap.name);
    // Point the new tenant at the name that was actually created, not at the
    // requested one: copyMapToTenant resolves name collisions by appending
    // `-2`, `-3`, … A fresh tenant has no maps, so the two normally match — but
    // if they ever diverge, storing the requested name would leave the tenant
    // with a defaultMapName no map answers to.
    await prismaClient.tenant.update({
      where: { id: tenantId },
      data: { defaultMapName: copied.name },
    });
    // Success is logged too: an empty new workspace is otherwise invisible in
    // the logs, and the silent failure paths above are the whole reason this
    // function is being rewritten.
    logger.info({ event: 'signup.template_copy_ok', tenantId, templateSlug, mapName: copied.name });
  } catch (e) {
    logger.error({ event: 'signup.template_copy_failed', tenantId, templateSlug, error: String(e) });
  }
}

/**
 * `name` is the TENANT/company display name, `ownerName` the natural person who
 * signed up. They are deliberately NOT interchangeable: mapping the company name
 * onto the mail's `name` is what produced the "Hallo <Firma>" greeting. When no
 * owner name reached us the greeting stays neutral (the template falls back to
 * "Hallo dort" / "Hi there") rather than addressing a person by their employer.
 */
function sendSignupWelcomeEmail(params: {
  email: string;
  name: string;
  slug: string;
  tenantId: string;
  ownerName?: string | null;
}): void {
  const { email, name, tenantId, ownerName } = params;
  const baseUrl = publicWebBase();
  if (!baseUrl) logger.error({ event: 'links.public_base_url_missing', route: 'signup.welcome' });
  const loginUrl = baseUrl ? buildPublicWebLink(baseUrl, 'app') : '';
  // OSS build without any mail provider: logged-only no-op (RootAdmin sees
  // the tenant directly in the UI). With EE-tenancy + RESEND_API_KEY or
  // with OSS-SMTP configured: send mail.
  //
  // Locale chain (Block C): we look up the recipient by email (the owner
  // of the freshly-signed-up tenant) and prefer their persisted UI locale
  // over the env default. Lookup runs in a detached promise so we keep
  // the synchronous void-return contract with the EE billing module.
  void (async () => {
    let userLocale: 'de' | 'en' | undefined;
    try {
      const user = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { locale: true },
      });
      userLocale = user?.locale === 'en' ? 'en' : user?.locale === 'de' ? 'de' : undefined;
    } catch (e) {
      logger.warn({
        event: 'signup.welcome_locale_lookup_failed',
        tenantId,
        error: String(e),
      });
    }
    await sendIfAvailable(
      (mod) =>
        mod.sendWelcome({
          to: email,
          name: ownerName ?? undefined,
          tenantName: name,
          loginUrl,
          locale: userLocale,
        }),
      'signup.welcome_email_failed',
      { tenantId },
    );
  })();
}

async function registerEnterpriseAdminRoutes(app: express.Express) {
  const adminEnterprise = await getAdminEnterpriseModule();
  if (!adminEnterprise) return;

  const tenancy = await getTenancyModule();

  // Optional telemetry module. The enterprise /public/config handler wins over
  // the OSS fallback (handleOssPublicConfig), so the host must surface the
  // telemetry activation block through it too — otherwise browser telemetry
  // never activates in an enterprise deployment. `getTelemetryModule` is cached
  // and self-warming, so awaiting it here (before the relay registration below)
  // is free. Undefined callback ⇒ no telemetry block (OSS/unconfigured).
  const telemetry = await getTelemetryModule();

  adminEnterprise.setupAdminRoutes(app, { prisma, logger, requireSuperAdmin });

  adminEnterprise.setupTenantAdminRoutes(app, {
    prisma,
    logger,
    requireSuperAdmin,
    resolveTenantDeletionPlan: tenantDeletionPlanResolver(process.env.DELETION_JOURNAL_DIR),
    isTenantSlugReserved: (slug) => isTenantSlugReserved(prisma, slug),
    computeOnlineUsageByTenantSlug,
    isMultiTenantEnabled: () => tenancy.isMultiTenantEnabled(),
    hashPassword: (password: string) => bcrypt.hash(password, 10),
    signSessionJwt: (payload) => jwt.sign(payload, getJwtSecret(), { expiresIn: '30d' }),
    setAuthCookie,
    normalizeEmail: normalizeEmailForStorage,
    copyTemplateMaps: (p, tenantId) => copyTemplateMapsForSignup(p, tenantId),
    deleteTenantWithMembers: (tenantId, options) => {
      assertTenantDeletionProtocol(options?.deletionProtocol);
      return deleteTenantWithMembers(prisma, tenantId, options);
    },
    sendWelcomeEmail: sendSignupWelcomeEmail,
    isNativeClientRequest,
    requireAuth,
    // Session-backed auth: the `Session` row is the authority, so the enterprise
    // signup must start sessions through the same single entry point every OSS
    // login path uses. Without this the signup would set a cookie with no
    // session row behind it and the session middleware — correctly — would
    // reject it on the very next request.
    establishSession: ({ req, res, userId, tenantId }) => establishSession({ prisma, req, res, userId, tenantId }),
    recordAuthEvent: (input) => recordAuthEvent(prisma, input),
    startEmailVerification: async ({ req, userId }) => {
      const outcome = await startEmailVerification({ prisma, userId, req });
      if (outcome.status === 'no_public_base_url') {
        logger.error({ event: 'links.public_base_url_missing', route: 'signup.email_verification' });
      }
      return outcome;
    },
    getTelemetryPublicConfig: telemetry ? () => telemetry.getPublicConfigBlock() : undefined,
  });

  adminEnterprise.setupPricingPlanRoutes(app, { prisma, logger, requireSuperAdmin });

  adminEnterprise.setupTenantUserRoutes(app, {
    prisma,
    logger,
    requireSuperAdmin,
    normalizeEmail: normalizeEmailForStorage,
    removeMemberFromTenant: (params) => removeMemberFromTenant(prisma, params),
  });

  adminEnterprise.setupPackMarketplaceRoutes(app, {
    prisma,
    logger,
    requireAuth,
    getTenantFromReq,
    requireMembership,
    requireSuperAdmin,
  });

  // Tauri desktop updater + download endpoints. Older enterprise builds may
  // not ship this setup function yet, so we gate the call.
  if (adminEnterprise.setupDesktopUpdateRoutes) {
    adminEnterprise.setupDesktopUpdateRoutes(app, { logger });
  }
}

async function getBillingOwnerEmail(tenantId: string): Promise<string | null> {
  try {
    const membership = await prisma.membership.findFirst({
      where: { tenantId, role: 'owner' },
      include: { user: { select: { email: true } } },
    });
    return membership?.user?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Register enterprise billing routes if the optional `@meetropolis/billing`
 * module is loaded. The OSS server passes only OSS-owned dependencies; the EE
 * module reads `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` from its own
 * process.env and skips route registration with a warning if either is
 * missing. This keeps every Stripe-specific concern inside the EE package and
 * lets the OSS server respond 404 to `/billing/*` when billing is not
 * configured.
 */
async function registerEnterpriseBillingRoutes(app: express.Express) {
  const billingModule = await getBillingModule();
  if (!billingModule) return;

  // Optional server-side analytics sink. When the enterprise telemetry module is
  // loaded, billing emits e.g. `purchase` from the Stripe webhook through this
  // host-callback. The OSS host is the single orchestrator that wires the two
  // otherwise-decoupled optional modules together (billing never imports
  // telemetry, telemetry never imports Stripe). `getTelemetryModule` is cached,
  // so warming it here (before `registerEnterpriseTelemetryRelay`) is free.
  const telemetryModule = await getTelemetryModule();

  const emailModule = await getEmailModule();
  const emailService = createBillingEmailService({
    emailModule,
    delivering: (await deliveringEmailModule()) !== null,
    logger,
  });

  const billingPortalUrl = process.env.BILLING_PORTAL_URL || process.env.BILLING_PUBLIC_URL || '';
  const pricingUrl = process.env.PRICING_URL || process.env.BILLING_PUBLIC_URL || '';

  const { default: express } = await import('express');
  const router = express.Router();
  billingModule.setupBillingRoutes(router, {
    prisma,
    emailService,
    logger,
    billingPortalUrl,
    pricingUrl,
    getOwnerEmail: getBillingOwnerEmail,
    requireTenantAdmin: requireTenantAdminMiddleware,
    // Without this the EE module cannot gate its operator endpoints and
    // `/billing/webhook-health` answers 501 forever — the webhook alarm would
    // exist in code but never be reachable, leaving a signature outage visible
    // only via log parsing, which is precisely what that endpoint replaces.
    requireSuperAdmin,
    getTenantId: (req: express.Request) => getTenantFromReq(req)?.id ?? null,
    getUserId: (req: express.Request) => getUserIdFromReq(req),
    // Loader-v3 concurrent-usage slot. `computeOnlineUsageByTenantSlug` is now
    // the canonical live count: distinct, non-NPC identities present in
    // Colyseus, aggregated per tenant across all rooms (see authHelpers.ts).
    // The same helper backs the adminLoader usage display, so `/billing/status`
    // reports exactly the metric the seat cap enforces. Keyed by tenant SLUG
    // (the EE billing route resolves the slug before calling).
    getConcurrentUsage: (tenantIdOrSlug: string) => computeOnlineUsageByTenantSlug()[tenantIdOrSlug] ?? 0,
    // Host-callback that lets the Stripe webhook emit a server-side `purchase`
    // event without billing importing the telemetry package. Undefined (inert)
    // in OSS-only builds or when telemetry is not configured.
    captureServerEvent: telemetryModule?.captureServerEvent,
    // Scheduled tenant deletion in the hourly billing pass (same deletion path and resolver).
    tenantDeletion: scheduledTenantDeletionDeps(),
  });
  // The EE module is responsible for logging its own initialization
  // (billing.routes.initialized) or its disabled-state warning
  // (billing.enterprise_disabled). The router is mounted unconditionally —
  // an empty router yields 404 for /billing/* which is the intended behaviour
  // when the EE module declines to register routes.
  app.use(router);
}

/**
 * Register the Signalyr telemetry relay (`/_signalyr/*`) if the optional
 * `@meetropolis/telemetry-node` module is loaded. The OSS server passes only its
 * own logger; the EE module reads `SIGNALYR_SECRET` / `SIGNALYR_PUBLIC_KEY` from
 * its own process.env and injects them into the proxied requests. In OSS-only
 * builds the module is absent, so no relay route exists and no tracker secret
 * ever lives in the open-source deployment. Loading the module here also warms
 * the loader cache that `/public/config` reads via `getTelemetryModuleSync`.
 */
async function registerEnterpriseTelemetryRelay(app: express.Express) {
  const telemetry = await getTelemetryModule();
  if (!telemetry) return;
  telemetry.setupSignalyrRelay(app, { logger });
}

async function registerEnterpriseTranscriptionRoutes(app: express.Express) {
  const transcription = await getTranscriptionModule();
  if (!transcription) return;
  transcription.setupRoutes(app, {
    prisma,
    logger,
    requireAuth,
    requireApiToken,
    resolveTenantBySlug,
    requireMembership,
    getEmailModule,
  });
}

function registerLegacyModularRoutes(app: express.Express) {
  registerPresenceRoutes(app, prisma, requireAuth, tenantContextFromReq);
  registerUserRoutes(app, prisma, requireAuth, tenantContextFromReq);
  registerMeAvatarRoutes(app, prisma, requireAuth);
  registerApiTokenRoutes(app, prisma, requireAuth, getApiTokenPepper());
  registerControlRoutes(app, requireAuth, (req) => requireApiToken(req, prisma));

  registerNpcRoutes(app, prisma);
  registerNpcMediaRoutes(app, prisma);
}

/**
 * Register all API routes on the Express app.
 *
 * Order matters: enterprise admin/tenant/pricing routes must be registered
 * BEFORE the OSS admin fallback so the enterprise variants of `/public/config`
 * win when the optional module is present. registerAdminUserRoutes registers
 * Multi-Tenant user-management routes; in OSS-only installs these are
 * harmless because the routes operate on a single internal tenant.
 */
export async function registerApi(app: express.Express) {
  // Validate the optional tenancy boundary during startup, even when no other
  // enterprise module is installed. A present but broken package must abort
  // boot instead of surfacing later as an OSS visibility fallback.
  await getTenancyModule();

  // FIRST: resolves the request's auth token against its Session row and
  // publishes the result for requireAuth (see api/utils/sessionAuth.ts). Every
  // route below — OSS and enterprise alike — depends on it; requireAuth fails
  // closed for any route registered ahead of it, so keep this line at the top.
  app.use(createSessionAuthMiddleware(prisma));
  // SECOND: drops the tenant context of authenticated callers who are not
  // members of the resolved tenant (see api/middleware/tenantAccess.ts), so
  // tenant-scoped routes fail closed instead of serving a foreign tenant.
  app.use(createTenantAccessMiddleware(prisma));
  // Protected pack and NPC media files; every request re-checks session,
  // membership and file owner itself (ops/memberAssetRoutes.ts).
  app.use(MEMBER_ASSETS_PREFIX, createMemberAssetRouter({ prisma }));

  // Account deletion journal: registered on every call, independent of the enterprise module.
  registerAccountJournalFromEnv();
  registerHealthRoutes(app, prisma);
  registerAuthRoutes(app, prisma);

  app.use(guestExpiryMiddleware);

  registerGuestRoutes(app, prisma);
  registerMiscRoutes(app, prisma);
  registerMapRoutes(app, prisma);
  registerTmjRoutes(app, prisma);
  registerMapObjectRoutes(app, prisma);
  registerAssetPackRoutes(app, prisma);
  registerAvatarPackRoutes(app, prisma);

  // Rate limit the public tenant sign-up (POST /public/tenants) BEFORE the
  // enterprise routes register it. Express dispatches route layers in
  // registration order, so this limiter runs first and, on success, calls
  // next() through to the enterprise handler — the closed-source
  // `@meetropolis/billing` package stays untouched. In OSS-only builds the EE
  // route is absent and this simply throttles an endpoint that 404s.
  app.post('/public/tenants', tenantSignupRateLimiter);

  // Enterprise admin/tenant/pricing first: Express dispatches to the first match,
  // so enterprise variants of /public/config and /admin/settings win when present.
  await registerEnterpriseAdminRoutes(app);
  await registerEnterpriseBillingRoutes(app);
  await registerEnterpriseTelemetryRelay(app);
  await registerEnterpriseTranscriptionRoutes(app);

  // OSS fallback admin routes (only health/stats/debug + minimal /public/config).
  registerAdminRoutes(app, prisma);
  registerTenantRoutes(app, prisma);
  // Opt-in per deployment: registers nothing unless CONTACT_FORM_TO and
  // ALTCHA_HMAC_KEY are both set (see routes/contact.ts).
  registerContactRoutes(app);
  // Native mobile clients: SSE downstream plus POST upstream, bridged into
  // the Colyseus world room server-side (see mobile/protocol.ts). Opt-in per
  // deployment: registers nothing unless MOBILE_GATEWAY_ENABLED is set (see
  // mobile/routes.ts).
  registerMobileRoutes(app);
  registerAdminMapRoutes(app, prisma);
  registerAdminPasswordResetRoutes(app, prisma);
  registerAdminAccountConfirmationRoutes(app, prisma);

  registerLegacyModularRoutes(app);
}
