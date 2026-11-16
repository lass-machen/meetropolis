/**
 * Startup configuration findings: key names only, never values.
 *
 * Collects every static configuration problem the server start would refuse,
 * calling the same validators the server start uses. Each finding names only
 * the environment key and a fixed English reason; values and validator
 * messages never leave this module. The checks never throw for a finding
 * they report; they only collect.
 */

import { findInvalidCredentialKeys } from './credentialPolicy.js';
import { ORIGIN_ENV_KEY, resolveOriginPolicy } from './originPolicy.js';
import { isRestorePending } from '../services/tenantDeletionRestoreMarker.js';
import { checkDeletionJournalConfig } from '../services/deletionJournalConfig.js';
import { parseToolsApiOrigins } from './toolsRoute.js';
import { resolveMetricsBind } from './metricsServer.js';
import { resolveWsUpgradeLimit } from './wsUpgradeLimit.js';
import { assertValidDefaultTenantSlug } from '../matchmake/tenantPartition.js';

/** The port the public server listens on. */
export function resolvePublicPort(env: NodeJS.ProcessEnv): number {
  return Number(env.PORT ?? 2567);
}

/** One static configuration problem: key name plus fixed reason. */
export interface StartupConfigFinding {
  key: string;
  reason: string;
}

/**
 * Run every static startup check and collect the findings in start order.
 * Never throws for a reported finding; an unexpected validator failure
 * propagates to the caller.
 */
export async function findStartupConfigFindings(env: NodeJS.ProcessEnv): Promise<StartupConfigFinding[]> {
  const findings: StartupConfigFinding[] = [];
  for (const key of findInvalidCredentialKeys(env)) {
    findings.push({ key, reason: 'unusable credential' });
  }
  if (!resolveOriginPolicy(env).ok) {
    findings.push({ key: ORIGIN_ENV_KEY, reason: 'missing or invalid origin list' });
  }
  const journalDir = env.DELETION_JOURNAL_DIR?.trim();
  if (journalDir && (await isRestorePending(journalDir))) {
    findings.push({ key: 'DELETION_JOURNAL_DIR', reason: 'restore pending' });
  }
  const journalConfig = checkDeletionJournalConfig(env);
  if (!journalConfig.ok) {
    findings.push({ key: journalConfig.key, reason: 'invalid deletion journal setting' });
  }
  if (env.TOOLS_USER && env.TOOLS_PASSWORD) {
    try {
      parseToolsApiOrigins(env.TOOLS_API_ORIGINS);
    } catch {
      findings.push({ key: 'TOOLS_API_ORIGINS', reason: 'invalid origin list' });
    }
  }
  try {
    resolveMetricsBind(env, resolvePublicPort(env));
  } catch {
    findings.push({ key: 'METRICS_PORT', reason: 'invalid port or equal to PORT' });
  }
  for (const key of ['WS_UPGRADE_RATE_LIMIT_MAX', 'WS_UPGRADE_RATE_LIMIT_WINDOW_MS']) {
    try {
      resolveWsUpgradeLimit({ [key]: env[key] });
    } catch {
      findings.push({ key, reason: 'invalid rate limit setting' });
    }
  }
  try {
    assertValidDefaultTenantSlug(env.DEFAULT_TENANT_SLUG);
  } catch {
    findings.push({ key: 'DEFAULT_TENANT_SLUG', reason: 'invalid tenant slug' });
  }
  return findings;
}
