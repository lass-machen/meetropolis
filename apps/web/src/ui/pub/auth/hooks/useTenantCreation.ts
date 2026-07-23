import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { openExternal } from '../../../../lib/openExternal';
import { isDesktopEnvironment } from '../../../../lib/desktopLoader';
import { getTelemetryModule } from '../../../../lib/telemetryLoader';
import type { RegistrationData } from '../AuthPageRenderer';
import type { TenantSignupSubmission } from '../signupTypes';

interface TenantCreateResponse {
  error?: string;
  token?: string | null;
}

interface UseTenantCreationArgs {
  apiBase: string;
  regData: RegistrationData;
  setError: (msg: string | null) => void;
  setSlugError: (msg: string | null) => void;
  setSubmitLoading: (loading: boolean) => void;
  setRegStep: (step: number) => void;
  setRegData: (updater: (prev: RegistrationData) => RegistrationData) => void;
  storeDesktopAuthToken: (token: string) => Promise<void>;
}

function redirectAfterTenantCreate() {
  // Root-domain architecture: the workspace lives on the current host. Tenant
  // context travels in the auth token / X-Tenant header (set after tenant
  // selection), not a subdomain, so every client — web, native, localhost —
  // enters the app via the in-app hash route on the same origin.
  window.location.hash = '#/app';
}

/** Map a server signup error code to a translated, user-facing message. */
function mapSignupError(code: string | undefined, t: (k: string) => string): string {
  if (code === 'b2b_required') return t('auth.errB2bRequired');
  return code || t('common.error');
}

/**
 * Create the card-backed trial checkout session (E4.1/E5.8, step two of the
 * signup flow). Runs on the API/signup origin with the just-set auth cookie
 * BEFORE any subdomain navigation. The tenant is addressed via the `X-Tenant`
 * slug header plus the fresh session (cookie for web, bearer token for native),
 * so the call resolves the newly created tenant regardless of the signup host.
 * Returns the Stripe checkout URL, or null when the server produced none.
 */
async function createCheckoutSession(
  apiBase: string,
  slug: string,
  tierKey: string,
  token: string | null,
): Promise<string | null> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Tenant': slug };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${apiBase}/billing/checkout-session`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ tierKey }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok) throw new Error(data.error || 'checkout_failed');
  return data.url ?? null;
}

function buildSignupBody(regData: RegistrationData, submission: TenantSignupSubmission) {
  const body: Record<string, unknown> = {
    slug: regData.slug,
    name: regData.teamName,
    email: regData.email,
    password: regData.password,
  };
  // The PERSON's name, kept apart from `name` (the company/team). The server
  // lands it on User.name, which drives the world name tag, the team list and
  // the welcome-mail greeting. Omitted rather than sent empty: the server
  // schema is `.min(1).optional()`, so an empty string would be a 400 — and a
  // missing name must not fail a signup, it just greets neutrally.
  const ownerName = [regData.firstName, regData.lastName].filter(Boolean).join(' ').trim();
  if (ownerName) body.ownerName = ownerName;
  if (submission.tierKey) body.tierKey = submission.tierKey;
  if (submission.b2b) {
    body.companyLegalName = submission.b2b.companyLegalName;
    body.legalForm = submission.b2b.legalForm;
    body.billingCountry = submission.b2b.billingCountry;
    if (submission.b2b.vatId) body.vatId = submission.b2b.vatId;
    body.b2bDeclaration = submission.b2b.b2bDeclaration;
    body.agbVersion = submission.b2b.agbVersion;
  }
  return body;
}

export function useTenantCreation({
  apiBase,
  regData,
  setError,
  setSlugError,
  setSubmitLoading,
  setRegStep,
  setRegData,
  storeDesktopAuthToken,
}: UseTenantCreationArgs) {
  const { t } = useTranslation('public');

  return useCallback(
    async (submission: TenantSignupSubmission) => {
      setSlugError(null);
      setError(null);
      setSubmitLoading(true);
      try {
        // Step one: create the tenant (sets the auth cookie / returns the token
        // for native clients).
        const res = await fetch(`${apiBase}/public/tenants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(buildSignupBody(regData, submission)),
        });
        const data = (await res.json()) as TenantCreateResponse;
        if (!res.ok) {
          if (data.error === 'slug_exists') {
            setSlugError(t('auth.slugExists'));
            setRegStep(2);
            return;
          }
          throw new Error(mapSignupError(data.error, t));
        }
        if (data.token) {
          await storeDesktopAuthToken(data.token);
        }

        // Registration succeeded (both the commercial and the free/OSS branch
        // exit below). Fire the optional telemetry signup event once here, before
        // any redirect, so it is queued even though the flow may navigate away.
        // Null-safe and fire-and-forget: no-op in OSS builds, never blocks.
        void getTelemetryModule()
          .then((t) => t?.trackSignup('tenant_create'))
          .catch(() => {});

        // Step two (commercial only): open the trial checkout BEFORE any
        // subdomain navigation — on this same origin the cookie is still valid.
        if (submission.b2b && submission.tierKey) {
          const checkoutUrl = await createCheckoutSession(
            apiBase,
            regData.slug,
            submission.tierKey,
            data.token ?? null,
          );
          if (checkoutUrl) {
            // Checkout is starting — fire the optional telemetry event before the
            // redirect. The module forwards it on the public web only (never the
            // desktop app). Null-safe and fire-and-forget.
            void getTelemetryModule()
              .then((t) => t?.trackBeginCheckout())
              .catch(() => {});
            // On the desktop (Tauri) client the checkout must open in the system
            // browser — the app has no in-app payment surface, and the token was
            // handed over above. On the web we navigate the current tab instead:
            // a post-`await` window.open would be swallowed by the popup blocker
            // and would strand the user in a foreign tab. Stripe's `success_url`
            // brings the customer back into the workspace afterwards.
            if (isDesktopEnvironment()) {
              await openExternal(checkoutUrl);
            } else {
              window.location.href = checkoutUrl;
            }
            return; // The post-checkout return handles entering the workspace.
          }
        }

        // Pure-OSS / non-commercial path: enter the app on the current origin.
        redirectAfterTenantCreate();
      } catch (e: unknown) {
        setError((e as Error).message);
      } finally {
        setSubmitLoading(false);
        setRegData((prev) => ({ ...prev, plan: submission.tierKey ?? prev.plan }));
      }
    },
    [apiBase, regData, storeDesktopAuthToken, t, setError, setSlugError, setSubmitLoading, setRegStep, setRegData],
  );
}
