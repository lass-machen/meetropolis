import type { Express } from 'express';
import { z } from 'zod';
import { logger } from './logger.js';

/**
 * Expected `version` of the `@meetropolis/telemetry-node` module. Single source
 * of truth for the loader's compatibility check: the zod schema, the cached
 * module and the load log all derive from it. Bump this in lockstep with the
 * module's `version` literal whenever the OSS-facing contract below changes
 * shape (mirrors `EXPECTED_BILLING_MODULE_VERSION` in `billingLoader.ts`).
 */
export const EXPECTED_TELEMETRY_MODULE_VERSION = 1 as const;

/**
 * Runtime activation block surfaced on `/public/config`. Contains no secrets —
 * only whether telemetry is enabled and which Signalyr environment the client
 * SDK should report (`web` | `desktop`). `null` means telemetry is off, in which
 * case the host omits the block from `/public/config` entirely.
 */
export interface SignalyrPublicConfig {
  enabled: boolean;
  environment: string;
}

/**
 * A server-side analytics event forwarded to the Signalyr Gate (e.g. `purchase`
 * from the Stripe `checkout.session.completed` handler). Generic shape so the
 * host can emit events without knowing Signalyr's wire contract.
 */
export interface ServerEvent {
  name: string;
  tenant?: string;
  properties?: Record<string, unknown>;
}

/**
 * Enterprise Telemetry Module interface.
 *
 * This is the contract between the OSS host (this file) and the closed-source
 * `@meetropolis/telemetry-node` package. The OSS server knows nothing about
 * Signalyr internals: the module reads its own secrets (`SIGNALYR_SECRET`,
 * `SIGNALYR_PUBLIC_KEY`, …) from its own `process.env` and the host never reads
 * or forwards them. Both sides evolve in lockstep via the `version` literal.
 */
export interface TelemetryModule {
  readonly version: typeof EXPECTED_TELEMETRY_MODULE_VERSION;

  /**
   * Install the raw-body parser for the event relay (`/_signalyr`). The host
   * calls this synchronously BEFORE its global `express.json()` (between
   * cookieParser and express.json, mirroring the billing early hook) so the
   * relay forwards the exact request bytes instead of a re-serialized object.
   * Optional so older module builds still load; when absent the relay's
   * route-local raw parser is the (functional) fallback.
   */
  installEarlyMiddleware?: (app: Express) => void;

  /**
   * Register the Signalyr relay routes (`/_signalyr/*`) on the host's Express
   * app. The relay injects the server-held secret / public key and proxies
   * events to the Gate and config to Core.
   */
  setupSignalyrRelay(
    app: Express,
    config: {
      logger: {
        info(obj: object): void;
        error(obj: object): void;
        warn(obj: object): void;
      };
    },
  ): void;

  /**
   * Return the `{ enabled, environment }` block for `/public/config`, or `null`
   * when telemetry is disabled (env not configured / module inactive).
   */
  getPublicConfigBlock(): SignalyrPublicConfig | null;

  /**
   * Forward a server-side event to the Signalyr Gate (e.g. the Stripe webhook
   * `purchase`). Optional so older module builds still load.
   */
  captureServerEvent?: (event: ServerEvent) => void;
}

export const telemetryModuleSchema = z.object({
  version: z.literal(EXPECTED_TELEMETRY_MODULE_VERSION),
  installEarlyMiddleware: z.function().optional(),
  setupSignalyrRelay: z.function(),
  getPublicConfigBlock: z.function(),
  captureServerEvent: z.function().optional(),
});

let cached: TelemetryModule | null = null;
let loadAttempted = false;

function unwrapDefaultExport(moduleValue: unknown): unknown {
  if (!moduleValue || typeof moduleValue !== 'object') return moduleValue;
  if (!('default' in moduleValue)) return moduleValue;
  const withDefault = moduleValue as { default?: unknown };
  return withDefault.default ?? moduleValue;
}

/**
 * Loads the optional enterprise telemetry module if present.
 * Returns null for OSS builds without enterprise features.
 */
export async function getTelemetryModule(): Promise<TelemetryModule | null> {
  if (loadAttempted) return cached;
  loadAttempted = true;

  try {
    // Dynamic import at runtime; absent in OSS.
    const modUnknown: unknown = await import('@meetropolis/telemetry-node');
    const mod = telemetryModuleSchema.parse(unwrapDefaultExport(modUnknown));

    cached = {
      version: EXPECTED_TELEMETRY_MODULE_VERSION,
      installEarlyMiddleware: mod.installEarlyMiddleware as TelemetryModule['installEarlyMiddleware'],
      setupSignalyrRelay: mod.setupSignalyrRelay as TelemetryModule['setupSignalyrRelay'],
      getPublicConfigBlock: mod.getPublicConfigBlock as TelemetryModule['getPublicConfigBlock'],
      captureServerEvent: mod.captureServerEvent as TelemetryModule['captureServerEvent'],
    };

    logger.info({ event: 'telemetry.enterprise_loaded', version: EXPECTED_TELEMETRY_MODULE_VERSION });
    return cached;
  } catch (_e) {
    // OSS build without enterprise telemetry - this is expected.
    logger.debug({ event: 'telemetry.enterprise_not_available', message: 'Telemetry disabled (OSS)' });
    cached = null;
    return null;
  }
}

/**
 * Get the telemetry module synchronously (returns null if not loaded yet).
 * Convenience accessor for hot paths that cannot await a dynamic import and
 * can rely on the module having been warmed during API registration (see
 * `registerEnterpriseTelemetryRelay` in api.ts). `/public/config` instead uses
 * the async `getTelemetryModule` directly, which is self-warming and cached.
 */
export function getTelemetryModuleSync(): TelemetryModule | null {
  return cached;
}
